use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("EmAPVEMNMa5vmS2GaFSjfNjg1JeWyUhy4fCe3c6PyoMp");

/// V1 — minimal ProofPay protocol.
///
/// State machine:
///   CREATED -> FUNDED -> IN_PROGRESS -> SUBMITTED -> VERIFIED -> SETTLED
///   SUBMITTED -> REJECTED -> IN_PROGRESS (resubmission loop)
///
/// Roles:
///   - business: creates + funds the job; pays USDC into escrow.
///   - worker:   accepts + submits; receives USDC on settlement.
///   - verifier: verifies / rejects; also acts as settlement authority for release.
///
/// Escrow:
///   - Associated Token Account (SPL Token) owned by the Job PDA.
///   - Only `release_payment` can move funds out, via PDA-signed CPI,
///     only from VERIFIED -> SETTLED, exactly once.
#[program]
pub mod proofpay {
    use super::*;

    /// 1. Business creates the job. Initializes the Job PDA in CREATED state.
    pub fn create_job(
        ctx: Context<CreateJob>,
        job_id: u64,
        worker: Pubkey,
        verifier: Pubkey,
        payment_amount: u64,
    ) -> Result<()> {
        require!(payment_amount > 0, ProofPayError::InvalidPaymentAmount);
        require!(
            worker != Pubkey::default(),
            ProofPayError::InvalidWorker
        );
        require!(
            verifier != Pubkey::default(),
            ProofPayError::InvalidVerifier
        );
        // Business cannot assign itself as the worker (would allow self-dealing
        // without independent field work). Keep minimal: hard require distinct.
        require!(
            worker != ctx.accounts.business.key(),
            ProofPayError::WorkerCannotBeBusiness
        );

        let job = &mut ctx.accounts.job;
        job.job_id = job_id;
        job.business = ctx.accounts.business.key();
        job.worker = worker;
        job.verifier = verifier;
        job.payment_amount = payment_amount;
        job.usdc_mint = ctx.accounts.usdc_mint.key();
        job.state = JobState::Created;
        job.created_at = Clock::get()?.unix_timestamp;
        job.bump = ctx.bumps.job;

        emit!(JobCreated {
            job: job.key(),
            job_id,
            business: job.business,
            worker,
            verifier,
            payment_amount,
            usdc_mint: job.usdc_mint,
        });
        Ok(())
    }

    /// 2. Business funds the job with USDC. CREATED -> FUNDED.
    pub fn fund_job(ctx: Context<FundJob>) -> Result<()> {
        let job = &mut ctx.accounts.job;

        // Never trust client-provided state: enforce on-chain transition.
        require!(
            job.state == JobState::Created,
            ProofPayError::InvalidStateTransition
        );
        // Only the business recorded at creation may fund.
        require!(
            ctx.accounts.business.key() == job.business,
            ProofPayError::UnauthorizedBusiness
        );
        // The mint of every token account must match the mint locked at creation.
        require!(
            ctx.accounts.business_ata.mint == job.usdc_mint,
            ProofPayError::InvalidMint
        );
        require!(
            ctx.accounts.escrow_ata.mint == job.usdc_mint,
            ProofPayError::InvalidMint
        );
        require!(
            ctx.accounts.usdc_mint.key() == job.usdc_mint,
            ProofPayError::InvalidMint
        );
        // Exact funding amount — no partial / over funding in V1.
        require!(
            ctx.accounts.business_ata.amount >= job.payment_amount,
            ProofPayError::InsufficientFunds
        );
        require!(job.payment_amount > 0, ProofPayError::InvalidPaymentAmount);

        let cpi_accounts = Transfer {
            from: ctx.accounts.business_ata.to_account_info(),
            to: ctx.accounts.escrow_ata.to_account_info(),
            authority: ctx.accounts.business.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, job.payment_amount)?;

        job.state = JobState::Funded;

        emit!(JobFunded {
            job: job.key(),
            job_id: job.job_id,
            amount: job.payment_amount,
        });
        Ok(())
    }

    /// 3. Worker accepts the job. FUNDED -> IN_PROGRESS.
    pub fn accept_job(ctx: Context<AcceptJob>) -> Result<()> {
        let job = &mut ctx.accounts.job;
        require!(
            job.state == JobState::Funded,
            ProofPayError::InvalidStateTransition
        );
        require!(
            ctx.accounts.worker.key() == job.worker,
            ProofPayError::UnauthorizedWorker
        );
        job.state = JobState::InProgress;

        emit!(JobAccepted {
            job: job.key(),
            job_id: job.job_id,
            worker: job.worker,
        });
        Ok(())
    }

    /// 4. Worker submits completion. IN_PROGRESS -> SUBMITTED.
    pub fn submit_job(ctx: Context<SubmitJob>) -> Result<()> {
        let job = &mut ctx.accounts.job;
        require!(
            job.state == JobState::InProgress,
            ProofPayError::InvalidStateTransition
        );
        require!(
            ctx.accounts.worker.key() == job.worker,
            ProofPayError::UnauthorizedWorker
        );
        job.state = JobState::Submitted;

        emit!(JobSubmitted {
            job: job.key(),
            job_id: job.job_id,
            worker: job.worker,
        });
        Ok(())
    }

    /// 5. Verifier approves completion. SUBMITTED -> VERIFIED.
    pub fn verify_job(ctx: Context<VerifyJob>) -> Result<()> {
        let job = &mut ctx.accounts.job;
        require!(
            job.state == JobState::Submitted,
            ProofPayError::InvalidStateTransition
        );
        require!(
            ctx.accounts.verifier.key() == job.verifier,
            ProofPayError::UnauthorizedVerifier
        );
        job.state = JobState::Verified;

        emit!(JobVerified {
            job: job.key(),
            job_id: job.job_id,
            verifier: job.verifier,
        });
        Ok(())
    }

    /// 6. Verifier rejects completion. SUBMITTED -> REJECTED.
    pub fn reject_job(ctx: Context<RejectJob>) -> Result<()> {
        let job = &mut ctx.accounts.job;
        require!(
            job.state == JobState::Submitted,
            ProofPayError::InvalidStateTransition
        );
        require!(
            ctx.accounts.verifier.key() == job.verifier,
            ProofPayError::UnauthorizedVerifier
        );
        job.state = JobState::Rejected;

        emit!(JobRejected {
            job: job.key(),
            job_id: job.job_id,
            verifier: job.verifier,
        });
        Ok(())
    }

    /// 7. Worker re-queues after rejection. REJECTED -> IN_PROGRESS.
    pub fn resubmit_job(ctx: Context<ResubmitJob>) -> Result<()> {
        let job = &mut ctx.accounts.job;
        require!(
            job.state == JobState::Rejected,
            ProofPayError::InvalidStateTransition
        );
        require!(
            ctx.accounts.worker.key() == job.worker,
            ProofPayError::UnauthorizedWorker
        );
        job.state = JobState::InProgress;

        emit!(JobResubmitted {
            job: job.key(),
            job_id: job.job_id,
            worker: job.worker,
        });
        Ok(())
    }

    /// 8. Settlement authority (verifier) releases escrow to worker.
    ///    VERIFIED -> SETTLED. Exactly once. Worker can never pull escrow directly.
    pub fn release_payment(ctx: Context<ReleasePayment>) -> Result<()> {
        // Read-only checks first; the borrow of `job` ends before the CPI.
        let job = &ctx.accounts.job;

        // Never allow release before VERIFIED; never allow release twice.
        // SETTLED jobs (or any non-VERIFIED state) fail here.
        require!(
            job.state == JobState::Verified,
            ProofPayError::PrematureRelease
        );
        // Authorized settlement authority = verifier recorded at creation.
        require!(
            ctx.accounts.settlement_authority.key() == job.verifier,
            ProofPayError::UnauthorizedSettlement
        );
        // Validate mint + destination on-chain (not client claims).
        require!(
            ctx.accounts.escrow_ata.mint == job.usdc_mint,
            ProofPayError::InvalidMint
        );
        require!(
            ctx.accounts.worker_ata.mint == job.usdc_mint,
            ProofPayError::InvalidMint
        );
        require!(
            ctx.accounts.worker_ata.owner == job.worker,
            ProofPayError::InvalidWorkerDestination
        );
        // Exact escrowed amount must still be present (guards partial drains).
        require!(
            ctx.accounts.escrow_ata.amount >= job.payment_amount,
            ProofPayError::AmountMismatch
        );
        require!(job.payment_amount > 0, ProofPayError::InvalidPaymentAmount);

        // Owned copies for the PDA signer seeds (ends the borrow of `job`).
        let payment_amount = job.payment_amount;
        let business = job.business;
        let job_id = job.job_id;
        let bump = job.bump;

        // PDA-signed CPI: Job PDA is the escrow authority.
        let job_id_bytes = job_id.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[
            b"job",
            business.as_ref(),
            job_id_bytes.as_ref(),
            &[bump],
        ];
        let signer = &[signer_seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_ata.to_account_info(),
            to: ctx.accounts.worker_ata.to_account_info(),
            authority: ctx.accounts.job.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        token::transfer(cpi_ctx, payment_amount)?;

        ctx.accounts.job.state = JobState::Settled;

        emit!(PaymentReleased {
            job: ctx.accounts.job.key(),
            job_id,
            worker: ctx.accounts.job.worker,
            amount: payment_amount,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct CreateJob<'info> {
    #[account(mut)]
    pub business: Signer<'info>,

    #[account(
        init,
        payer = business,
        space = 8 + Job::INIT_SPACE,
        seeds = [b"job", business.key().as_ref(), job_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub job: Account<'info, Job>,

    /// USDC mint locked into the job at creation. All later token
    /// accounts must use this mint.
    pub usdc_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundJob<'info> {
    #[account(mut)]
    pub business: Signer<'info>,

    #[account(
        mut,
        seeds = [b"job", job.business.as_ref(), job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
    )]
    pub job: Account<'info, Job>,

    /// Mint must equal job.usdc_mint (checked in handler).
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = business,
    )]
    pub business_ata: Account<'info, TokenAccount>,

    /// Program-controlled escrow ATA, owned by the Job PDA.
    /// Created on first fund; holds exactly `payment_amount` until release.
    #[account(
        init_if_needed,
        payer = business,
        associated_token::mint = usdc_mint,
        associated_token::authority = job,
    )]
    pub escrow_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptJob<'info> {
    pub worker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"job", job.business.as_ref(), job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
    )]
    pub job: Account<'info, Job>,
}

#[derive(Accounts)]
pub struct SubmitJob<'info> {
    pub worker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"job", job.business.as_ref(), job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
    )]
    pub job: Account<'info, Job>,
}

#[derive(Accounts)]
pub struct VerifyJob<'info> {
    pub verifier: Signer<'info>,

    #[account(
        mut,
        seeds = [b"job", job.business.as_ref(), job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
    )]
    pub job: Account<'info, Job>,
}

#[derive(Accounts)]
pub struct RejectJob<'info> {
    pub verifier: Signer<'info>,

    #[account(
        mut,
        seeds = [b"job", job.business.as_ref(), job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
    )]
    pub job: Account<'info, Job>,
}

#[derive(Accounts)]
pub struct ResubmitJob<'info> {
    pub worker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"job", job.business.as_ref(), job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
    )]
    pub job: Account<'info, Job>,
}

#[derive(Accounts)]
pub struct ReleasePayment<'info> {
    /// Settlement authority — must equal job.verifier (checked in handler).
    pub settlement_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"job", job.business.as_ref(), job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
    )]
    pub job: Account<'info, Job>,

    #[account(
        mut,
        associated_token::mint = job.usdc_mint,
        associated_token::authority = job,
    )]
    pub escrow_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub worker_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// V1 job account. Fixed layout — do not reorder fields without a migration.
#[account]
#[derive(InitSpace)]
pub struct Job {
    pub job_id: u64,
    pub business: Pubkey,
    pub worker: Pubkey,
    pub verifier: Pubkey,
    pub payment_amount: u64,
    pub usdc_mint: Pubkey,
    pub state: JobState,
    pub created_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum JobState {
    Created,
    Funded,
    InProgress,
    Submitted,
    Verified,
    Rejected,
    Settled,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct JobCreated {
    pub job: Pubkey,
    pub job_id: u64,
    pub business: Pubkey,
    pub worker: Pubkey,
    pub verifier: Pubkey,
    pub payment_amount: u64,
    pub usdc_mint: Pubkey,
}

#[event]
pub struct JobFunded {
    pub job: Pubkey,
    pub job_id: u64,
    pub amount: u64,
}

#[event]
pub struct JobAccepted {
    pub job: Pubkey,
    pub job_id: u64,
    pub worker: Pubkey,
}

#[event]
pub struct JobSubmitted {
    pub job: Pubkey,
    pub job_id: u64,
    pub worker: Pubkey,
}

#[event]
pub struct JobVerified {
    pub job: Pubkey,
    pub job_id: u64,
    pub verifier: Pubkey,
}

#[event]
pub struct JobRejected {
    pub job: Pubkey,
    pub job_id: u64,
    pub verifier: Pubkey,
}

#[event]
pub struct JobResubmitted {
    pub job: Pubkey,
    pub job_id: u64,
    pub worker: Pubkey,
}

#[event]
pub struct PaymentReleased {
    pub job: Pubkey,
    pub job_id: u64,
    pub worker: Pubkey,
    pub amount: u64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum ProofPayError {
    #[msg("Invalid state transition for the current job state.")]
    InvalidStateTransition,
    #[msg("Only the business recorded at job creation may perform this action.")]
    UnauthorizedBusiness,
    #[msg("Only the assigned worker may perform this action.")]
    UnauthorizedWorker,
    #[msg("Only the assigned verifier may perform this action.")]
    UnauthorizedVerifier,
    #[msg("Only the authorized settlement authority (verifier) may release payment.")]
    UnauthorizedSettlement,
    #[msg("Token mint does not match the USDC mint locked at job creation.")]
    InvalidMint,
    #[msg("Payment amount must be greater than zero.")]
    InvalidPaymentAmount,
    #[msg("Business token account holds insufficient funds for the payment amount.")]
    InsufficientFunds,
    #[msg("Escrow balance does not match the locked payment amount.")]
    AmountMismatch,
    #[msg("Payment can only be released from VERIFIED state, exactly once.")]
    PrematureRelease,
    #[msg("Worker destination token account is not owned by the assigned worker.")]
    InvalidWorkerDestination,
    #[msg("Invalid worker pubkey.")]
    InvalidWorker,
    #[msg("Invalid verifier pubkey.")]
    InvalidVerifier,
    #[msg("Worker cannot be the business itself.")]
    WorkerCannotBeBusiness,
}
