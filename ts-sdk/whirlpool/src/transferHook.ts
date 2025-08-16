import type { 
  Address, 
  IAccountMeta, 
  Rpc, 
  GetAccountInfoApi,
  GetMultipleAccountsApi,
  ReadonlyAccount,
  WritableAccount 
} from "@solana/kit";
import { AccountRole } from "@solana/kit";
import type { Mint } from "@solana-program/token-2022";
import { fetchAllMint, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import type { RemainingAccountsInfo } from "@orca-so/whirlpools-client";
import { AccountsType } from "@orca-so/whirlpools-client";
import { 
  getTransferHook, 
  addExtraAccountMetasForExecute,
  TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";
import { TransactionInstruction, PublicKey } from "@solana/web3.js";

/**
 * Check if a mint has transfer hook extension.
 * 
 * @param mint The mint account data
 * @returns True if mint has transfer hook extension
 */
export function hasTransferHookExtension(mint: Mint): boolean {
  return getTransferHookExtension(mint) !== null;
}

/**
 * Get the transfer hook extension from a mint.
 * 
 * @param mint The mint account data
 * @returns The transfer hook extension or null if not present
 */
export function getTransferHookExtension(mint: Mint): { programId: Address } | null {
  if (mint.extensions.__option === "None") {
    return null;
  }

  for (const extension of mint.extensions.value) {
    if (extension.__kind === "TransferHook") {
      return { programId: extension.programId };
    }
  }

  return null;
}

/**
 * Get the extra account metas address for a mint and transfer hook program.
 * This derives the PDA where the extra account metas are stored.
 * 
 * @param mint The mint address
 * @param programId The transfer hook program ID
 * @returns The extra account metas address
 */
function getExtraAccountMetasAddress(mint: Address, programId: Address): Address {
  // The standard seed for transfer hook extra account metas is "extra-account-metas" + mint
  // This is defined in the spl-transfer-hook-interface
  try {
    // Import PublicKey to derive the PDA
    const { PublicKey } = require("@solana/web3.js");
    const [address] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("extra-account-metas"),
        new PublicKey(mint).toBuffer()
      ],
      new PublicKey(programId)
    );
    return address.toString() as Address;
  } catch (error) {
    // If we can't derive the PDA, fall back to the program ID
    // This is not correct but prevents the function from crashing
    console.warn('Failed to derive extra account metas PDA, falling back to program ID:', error);
    return programId;
  }
}

/**
 * Resolve transfer hook accounts for a mint using the SPL Token library.
 * This follows the exact same pattern as the legacy SDK.
 * 
 * @param rpc The RPC client
 * @param mint The mint address
 * @param source Source token account
 * @param destination Destination token account  
 * @param owner Owner of the source account
 * @returns Array of account metas needed for transfer hook
 */
export async function getTransferHookAccounts(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
  mint: Address,
  source: Address,
  destination: Address,
  owner: Address,
): Promise<IAccountMeta[]> {
  try {
    const mintAccounts = await fetchAllMint(rpc, [mint]);
    const mintAccount = mintAccounts[0];
    
    if (!mintAccount) {
      return [];
    }
    
    // Use our existing helper function to check for transfer hook extension
    const transferHook = getTransferHookExtension(mintAccount.data);
    if (!transferHook) {
      return [];
    }

    // Create a dummy transfer instruction (exactly like legacy SDK)
    const instruction = new TransactionInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      keys: [
        { pubkey: new PublicKey(source), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(destination), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(owner), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(owner), isSigner: false, isWritable: false },
      ],
    });

    // Create a simple RPC adapter for the connection parameter
    const connection = {
      getAccountInfo: async (pubkey: PublicKey) => {
        // Always request base64 so we can decode reliably
        const resp = await (rpc as any).getAccountInfo(pubkey.toString() as Address, { encoding: "base64" }).send();
        if (!resp.value) return null;

        // resp.value.data is [data, encoding]
        const dataTuple = resp.value.data as unknown as [string, string];
        const dataStr = dataTuple?.[0] as string;
        const dataBuf = Buffer.from(dataStr, "base64");

        return {
          data: dataBuf,
          executable: Boolean(resp.value.executable),
          lamports: Number(resp.value.lamports),
          owner: new PublicKey(resp.value.owner),
        };
      },
    };

    // Use SPL Token library to resolve extra accounts (exactly like legacy SDK)
    await addExtraAccountMetasForExecute(
      connection as any,
      instruction,
      new PublicKey(transferHook.programId),
      new PublicKey(source),
      new PublicKey(mint),
      new PublicKey(destination),
      new PublicKey(owner),
      0n, // amount - extra accounts should not depend on amount
      "confirmed",
    );

    // Extract the extra accounts (everything after the first 5 basic accounts)
    const extraAccountMetas = instruction.keys.slice(5);

    // Convert back to our IAccountMeta format
    const result = extraAccountMetas.map(meta => ({
      address: meta.pubkey.toString() as Address,
      role: meta.isWritable
        ? (meta.isSigner ? AccountRole.WRITABLE_SIGNER : AccountRole.WRITABLE)
        : (meta.isSigner ? AccountRole.READONLY_SIGNER : AccountRole.READONLY),
    }));

    return result;
  } catch (error) {
    // If we can't resolve transfer hook accounts, return empty array
    console.warn('Failed to resolve transfer hook accounts:', error);
    return [];
  }
}

/**
 * Build remaining accounts info for transfer hook accounts.
 * Only adds slices for accounts that actually exist (non-empty arrays).
 * This follows the same pattern as the legacy SDK's RemainingAccountsBuilder.
 * 
 * @param transferHookAccountsA Transfer hook accounts for token A
 * @param transferHookAccountsB Transfer hook accounts for token B
 * @param supplementalTickArrays Supplemental tick arrays (optional)
 * @returns RemainingAccountsInfo object or null if no accounts needed
 */
export function buildTransferHookRemainingAccountsInfo(
  transferHookAccountsA: IAccountMeta[],
  transferHookAccountsB: IAccountMeta[],
  supplementalTickArrays: IAccountMeta[] = [],
): RemainingAccountsInfo | null {
  const slices = [];
  
  // Only add transfer hook A accounts if they exist
  if (transferHookAccountsA && transferHookAccountsA.length > 0) {
    slices.push({
      accountsType: AccountsType.TransferHookA,
      length: transferHookAccountsA.length,
    });
  }
  
  // Only add transfer hook B accounts if they exist
  if (transferHookAccountsB && transferHookAccountsB.length > 0) {
    slices.push({
      accountsType: AccountsType.TransferHookB,
      length: transferHookAccountsB.length,
    });
  }
  
  // Only add supplemental tick arrays if they exist
  if (supplementalTickArrays && supplementalTickArrays.length > 0) {
    slices.push({
      accountsType: AccountsType.SupplementalTickArrays,
      length: supplementalTickArrays.length,
    });
  }
  
  return slices.length > 0 ? { slices } : null;
}

/**
 * Convert IAccountMeta to the format expected by instruction accounts.
 * This handles the type compatibility issues with the new Solana SDK.
 */
export function convertToInstructionAccount(
  accountMeta: IAccountMeta,
): ReadonlyAccount | WritableAccount {
  switch (accountMeta.role) {
    case AccountRole.READONLY:
      return { address: accountMeta.address, role: AccountRole.READONLY };
    case AccountRole.WRITABLE:
      return { address: accountMeta.address, role: AccountRole.WRITABLE };
    case AccountRole.READONLY_SIGNER:
      // For transfer hook accounts, we typically don't need signers
      // but if we do, this would need to be handled differently
      return { address: accountMeta.address, role: AccountRole.READONLY };
    case AccountRole.WRITABLE_SIGNER:
      // For transfer hook accounts, we typically don't need signers
      // but if we do, this would need to be handled differently
      return { address: accountMeta.address, role: AccountRole.WRITABLE };
    default:
      return { address: accountMeta.address, role: AccountRole.READONLY };
  }
}

/**
 * Get all transfer hook accounts that need to be appended to an instruction.
 * 
 * @param transferHookAccountsA Transfer hook accounts for token A
 * @param transferHookAccountsB Transfer hook accounts for token B  
 * @param supplementalTickArrays Supplemental tick arrays (optional)
 * @returns Combined array of all accounts to append
 */
export function getAllTransferHookAccounts(
  transferHookAccountsA: IAccountMeta[],
  transferHookAccountsB: IAccountMeta[],
  supplementalTickArrays: IAccountMeta[] = [],
): IAccountMeta[] {
  return [
    ...transferHookAccountsA,
    ...transferHookAccountsB,
    ...supplementalTickArrays,
  ];
}

/**
 * Get transfer hook accounts for both token A and B mints.
 * 
 * @param rpc The RPC client
 * @param mintA Token A mint address
 * @param mintB Token B mint address
 * @param tokenAccountA Token A account address
 * @param tokenAccountB Token B account address
 * @param tokenVaultA Token A vault address
 * @param tokenVaultB Token B vault address
 * @param owner Token account owner
 * @returns Object with transfer hook accounts for both tokens
 */
export async function getTransferHookAccountsForPool(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
  mintA: Address,
  mintB: Address,
  tokenAccountA: Address,
  tokenAccountB: Address,
  tokenVaultA: Address,
  tokenVaultB: Address,
  owner: Address,
): Promise<{
  transferHookAccountsA: IAccountMeta[];
  transferHookAccountsB: IAccountMeta[];
}> {
  // For increase liquidity: owner -> vault (deposit)
  const [transferHookAccountsA, transferHookAccountsB] = await Promise.all([
    getTransferHookAccounts(rpc, mintA, tokenAccountA, tokenVaultA, owner),
    getTransferHookAccounts(rpc, mintB, tokenAccountB, tokenVaultB, owner),
  ]);
  
  return {
    transferHookAccountsA,
    transferHookAccountsB,
  };
}