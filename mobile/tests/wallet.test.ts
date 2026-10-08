/** Wallet wrapper: success returns the address, absence is a friendly error. */
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { connectWallet, signDigest, WalletUnavailableError } from "../src/wallet/MobileWallet";

const mockedTransact = transact as unknown as jest.Mock;

describe("MobileWallet", () => {
  beforeEach(() => mockedTransact.mockReset());

  it("connect returns the authorized address", async () => {
    mockedTransact.mockImplementation(async (cb: any) =>
      cb({
        authorize: async () => ({
          accounts: [{ address: "Wallet111111111111111111111111111111111111111" }],
          authToken: "token",
        }),
      })
    );
    const session = await connectWallet();
    expect(session.address).toBe("Wallet111111111111111111111111111111111111111");
  });

  it("missing wallet becomes WalletUnavailableError (never a crash)", async () => {
    mockedTransact.mockRejectedValue(new Error("No wallet app"));
    await expect(connectWallet()).rejects.toBeInstanceOf(WalletUnavailableError);
  });

  it("signDigest returns wallet-produced bytes (Seed Vault does the signing)", async () => {
    mockedTransact.mockImplementation(async (cb: any) =>
      cb({
        signMessages: async () => ({ signedPayloads: [new Uint8Array([1, 2, 3])] }),
      })
    );
    const sig = await signDigest("token", new Uint8Array([9, 9]));
    expect(Array.from(sig)).toEqual([1, 2, 3]);
  });

  it("wallets without message signing fail loudly", async () => {
    mockedTransact.mockImplementation(async (cb: any) => cb({}));
    await expect(signDigest("token", new Uint8Array([9]))).rejects.toBeInstanceOf(
      WalletUnavailableError
    );
  });
});
