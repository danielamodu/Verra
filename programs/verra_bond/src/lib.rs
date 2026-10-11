use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("fza6wCHJfcQ3DVDjPg7vmC3zJGgTQymKoN844by3qBy");

/// Verra verifier-bond program.
///
/// SKR staking that gives Verra's verification a real economic security
/// layer: a verifier must post (and keep) an SKR bond to be authorized to
/// run `verify_job`; a dispute lets a program-admin-configured arbiter slash
/// that bond. This program is ADDITIVE — it never touches the `proofpay`
/// escrow program or its USDC settlement. Bond-gating of authorization is
/// enforced by the backend (see docs/skr-bond.md); it is NOT yet a direct
/// on-chain CPI invariant inside `proofpay`.
///
/// Trust note: the arbiter and the backend authorization check are TRUSTED
/// roles. This raises the cost of a dishonest verifier (their stake is at
/// risk); it does not make verification trustless.
///
/// Accounts:
///   - BondConfig  PDA ["config"]        — admin-owned policy (arbiter, mint,
///                                          min bond, treasury).
///   - VerifierBond PDA ["bond", verifier] — one bond per verifier.
///   - vault: ATA(skr_mint) owned by the VerifierBond PDA — holds the stake.
#[program]
pub mod verra_bond {
    use super::*;

    /// Initialize the single program config. The signer becomes `admin`.
    /// The arbiter is set HERE, by the admin — a verifier can never choose
    /// their own arbiter.
    pub fn init_config(
        ctx: Context<InitConfig>,
        arbiter: Pubkey,
        min_bond: u64,
        treasury: Pubkey,
    ) -> Result<()> {
        require!(min_bond > 0, BondError::InvalidAmount);
        require!(arbiter != Pubkey::default(), BondError::InvalidArbiter);
        require!(treasury != Pubkey::default(), BondError::InvalidTreasury);

        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.arbiter = arbiter;
        cfg.skr_mint = ctx.accounts.skr_mint.key();
        cfg.min_bond = min_bond;
        cfg.treasury = treasury;
        cfg.bump = ctx.bumps.config;

        emit!(ConfigInitialized {
            admin: cfg.admin,
            arbiter,
            skr_mint: cfg.skr_mint,
            min_bond,
            treasury,
        });
        Ok(())
    }

    /// Admin-only: rotate the arbiter. Rejects any non-admin signer.
    pub fn set_arbiter(ctx: Context<AdminOnly>, new_arbiter: Pubkey) -> Result<()> {
        require!(new_arbiter != Pubkey::default(), BondError::InvalidArbiter);
        require!(
            ctx.accounts.admin.key() == ctx.accounts.config.admin,
            BondError::UnauthorizedAdmin
        );
        let cfg = &mut ctx.accounts.config;
        let previous = cfg.arbiter;
        cfg.arbiter = new_arbiter;
        emit!(ArbiterChanged { previous, arbiter: new_arbiter });
        Ok(())
    }

    /// Admin-only: adjust the minimum bond.
    pub fn set_min_bond(ctx: Context<AdminOnly>, min_bond: u64) -> Result<()> {
        require!(min_bond > 0, BondError::InvalidAmount);
        require!(
            ctx.accounts.admin.key() == ctx.accounts.config.admin,
            BondError::UnauthorizedAdmin
        );
        ctx.accounts.config.min_bond = min_bond;
        Ok(())
    }

    /// Verifier stakes (or tops up) SKR. Works from a fresh bond and from a
    /// previously Withdrawn or Slashed bond (re-staking). After the transfer
    /// the running total must be >= the configured minimum, so a stake that
    /// does not reach the floor is rejected.
    pub fn stake_bond(ctx: Context<StakeBond>, amount: u64) -> Result<()> {
        require!(amount > 0, BondError::InvalidAmount);
        require!(
            ctx.accounts.skr_mint.key() == ctx.accounts.config.skr_mint,
            BondError::InvalidMint
        );
        require!(
            ctx.accounts.verifier_ata.mint == ctx.accounts.config.skr_mint,
            BondError::InvalidMint
        );
        require!(
            ctx.accounts.vault.mint == ctx.accounts.config.skr_mint,
            BondError::InvalidMint
        );

        let cpi = Transfer {
            from: ctx.accounts.verifier_ata.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.verifier.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi),
            amount,
        )?;

        let bond = &mut ctx.accounts.bond;
        bond.verifier = ctx.accounts.verifier.key();
        bond.bump = ctx.bumps.bond;
        bond.amount = bond.amount.checked_add(amount).ok_or(BondError::Overflow)?;
        bond.state = BondState::Active;
        bond.staked_at = Clock::get()?.unix_timestamp;

        require!(
            bond.amount >= ctx.accounts.config.min_bond,
            BondError::BelowMinimumBond
        );

        emit!(BondStaked {
            verifier: bond.verifier,
            amount,
            total: bond.amount,
        });
        Ok(())
    }

    /// Arbiter-only: lock a bond so the verifier cannot withdraw while a
    /// dispute is unresolved (or while the verifier is still required active).
    pub fn lock_bond(ctx: Context<ArbiterAction>) -> Result<()> {
        require!(
            ctx.accounts.arbiter.key() == ctx.accounts.config.arbiter,
            BondError::UnauthorizedArbiter
        );
        ctx.accounts.bond.locked = true;
        emit!(BondLockChanged { verifier: ctx.accounts.bond.verifier, locked: true });
        Ok(())
    }

    /// Arbiter-only: clear a lock.
    pub fn unlock_bond(ctx: Context<ArbiterAction>) -> Result<()> {
        require!(
            ctx.accounts.arbiter.key() == ctx.accounts.config.arbiter,
            BondError::UnauthorizedArbiter
        );
        ctx.accounts.bond.locked = false;
        emit!(BondLockChanged { verifier: ctx.accounts.bond.verifier, locked: false });
        Ok(())
    }

    /// Arbiter-only: slash part or all of a bond to the configured treasury.
    /// Partial slash leaves the bond Active (likely below minimum, so the
    /// verifier is no longer authorized until they top up). A full slash
    /// drains the vault and marks the bond Slashed.
    pub fn slash_bond(ctx: Context<SlashBond>, amount: u64) -> Result<()> {
        require!(amount > 0, BondError::InvalidAmount);
        require!(
            ctx.accounts.arbiter.key() == ctx.accounts.config.arbiter,
            BondError::UnauthorizedArbiter
        );
        require!(
            ctx.accounts.treasury_ata.owner == ctx.accounts.config.treasury,
            BondError::InvalidTreasury
        );
        require!(
            ctx.accounts.treasury_ata.mint == ctx.accounts.config.skr_mint,
            BondError::InvalidMint
        );

        let bond = &mut ctx.accounts.bond;
        require!(bond.state == BondState::Active, BondError::BondNotActive);
        require!(amount <= bond.amount, BondError::InsufficientBond);

        let verifier = bond.verifier;
        let bump = bond.bump;
        let seeds: &[&[u8]] = &[b"bond", verifier.as_ref(), &[bump]];
        let signer = &[seeds];
        let cpi = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.treasury_ata.to_account_info(),
            authority: ctx.accounts.bond.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi,
                signer,
            ),
            amount,
        )?;

        let bond = &mut ctx.accounts.bond;
        bond.amount = bond.amount.checked_sub(amount).ok_or(BondError::Overflow)?;
        if bond.amount == 0 {
            bond.state = BondState::Slashed;
        }
        emit!(BondSlashed {
            verifier,
            amount,
            remaining: bond.amount,
            arbiter: ctx.accounts.arbiter.key(),
        });
        Ok(())
    }

    /// Verifier withdraws their full remaining bond. Only from Active state
    /// and only when NOT locked — a locked bond (dispute unresolved, or the
    /// verifier still required) cannot be withdrawn.
    pub fn withdraw_bond(ctx: Context<WithdrawBond>) -> Result<()> {
        let bond = &ctx.accounts.bond;
        require!(bond.state == BondState::Active, BondError::BondNotActive);
        require!(!bond.locked, BondError::BondLocked);
        require!(bond.amount > 0, BondError::InsufficientBond);
        require!(
            ctx.accounts.verifier_ata.owner == bond.verifier,
            BondError::InvalidDestination
        );
        require!(
            ctx.accounts.verifier_ata.mint == ctx.accounts.config.skr_mint,
            BondError::InvalidMint
        );

        let verifier = bond.verifier;
        let bump = bond.bump;
        let amount = bond.amount;
        let seeds: &[&[u8]] = &[b"bond", verifier.as_ref(), &[bump]];
        let signer = &[seeds];
        let cpi = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.verifier_ata.to_account_info(),
            authority: ctx.accounts.bond.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi,
                signer,
            ),
            amount,
        )?;

        let bond = &mut ctx.accounts.bond;
        bond.amount = 0;
        bond.state = BondState::Withdrawn;
        emit!(BondWithdrawn { verifier, amount });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + BondConfig::INIT_SPACE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, BondConfig>,
    pub skr_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, BondConfig>,
}

#[derive(Accounts)]
pub struct StakeBond<'info> {
    #[account(mut)]
    pub verifier: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, BondConfig>,
    #[account(
        init_if_needed,
        payer = verifier,
        space = 8 + VerifierBond::INIT_SPACE,
        seeds = [b"bond", verifier.key().as_ref()],
        bump,
    )]
    pub bond: Account<'info, VerifierBond>,
    pub skr_mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = skr_mint,
        associated_token::authority = verifier,
    )]
    pub verifier_ata: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = verifier,
        associated_token::mint = skr_mint,
        associated_token::authority = bond,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ArbiterAction<'info> {
    pub arbiter: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, BondConfig>,
    #[account(
        mut,
        seeds = [b"bond", bond.verifier.as_ref()],
        bump = bond.bump,
    )]
    pub bond: Account<'info, VerifierBond>,
}

#[derive(Accounts)]
pub struct SlashBond<'info> {
    pub arbiter: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, BondConfig>,
    #[account(
        mut,
        seeds = [b"bond", bond.verifier.as_ref()],
        bump = bond.bump,
    )]
    pub bond: Account<'info, VerifierBond>,
    #[account(
        mut,
        associated_token::mint = config.skr_mint,
        associated_token::authority = bond,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawBond<'info> {
    pub verifier: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, BondConfig>,
    #[account(
        mut,
        seeds = [b"bond", verifier.key().as_ref()],
        bump = bond.bump,
        constraint = bond.verifier == verifier.key() @ BondError::UnauthorizedVerifier,
    )]
    pub bond: Account<'info, VerifierBond>,
    #[account(
        mut,
        associated_token::mint = config.skr_mint,
        associated_token::authority = bond,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub verifier_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct BondConfig {
    pub admin: Pubkey,
    pub arbiter: Pubkey,
    pub skr_mint: Pubkey,
    pub min_bond: u64,
    pub treasury: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VerifierBond {
    pub verifier: Pubkey,
    pub amount: u64,
    pub state: BondState,
    pub locked: bool,
    pub staked_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BondState {
    None,
    Active,
    Slashed,
    Withdrawn,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub arbiter: Pubkey,
    pub skr_mint: Pubkey,
    pub min_bond: u64,
    pub treasury: Pubkey,
}

#[event]
pub struct ArbiterChanged {
    pub previous: Pubkey,
    pub arbiter: Pubkey,
}

#[event]
pub struct BondStaked {
    pub verifier: Pubkey,
    pub amount: u64,
    pub total: u64,
}

#[event]
pub struct BondLockChanged {
    pub verifier: Pubkey,
    pub locked: bool,
}

#[event]
pub struct BondSlashed {
    pub verifier: Pubkey,
    pub amount: u64,
    pub remaining: u64,
    pub arbiter: Pubkey,
}

#[event]
pub struct BondWithdrawn {
    pub verifier: Pubkey,
    pub amount: u64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum BondError {
    #[msg("Amount must be greater than zero.")]
    InvalidAmount,
    #[msg("Arbiter pubkey is invalid.")]
    InvalidArbiter,
    #[msg("Treasury pubkey is invalid.")]
    InvalidTreasury,
    #[msg("Only the program admin may perform this action.")]
    UnauthorizedAdmin,
    #[msg("Only the configured arbiter may perform this action.")]
    UnauthorizedArbiter,
    #[msg("Only the bonded verifier may perform this action.")]
    UnauthorizedVerifier,
    #[msg("Token mint does not match the configured SKR mint.")]
    InvalidMint,
    #[msg("Destination token account is not owned by the expected authority.")]
    InvalidDestination,
    #[msg("Resulting bond is below the configured minimum.")]
    BelowMinimumBond,
    #[msg("Bond is not in an active state.")]
    BondNotActive,
    #[msg("Bond is locked and cannot be withdrawn.")]
    BondLocked,
    #[msg("Bond has insufficient balance for this operation.")]
    InsufficientBond,
    #[msg("Arithmetic overflow.")]
    Overflow,
}
