import type { ExtensionArgs, Mint } from "@solana-program/token-2022";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  getMintSize,
  getInitializeMint2Instruction,
  fetchMint,
} from "@solana-program/token-2022";
import type { Address, IInstruction, IAccountMeta, Rpc, GetAccountInfoApi } from "@solana/kit";
import { AccountRole, address } from "@solana/kit";
import { sendTransaction, signer } from "./mockRpc";
import { getCreateAccountInstruction, SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { getNextKeypair } from "./keypair";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

// Transfer hook program ID from legacy SDK tests
// This should match the transfer hook program used in legacy SDK
export const TEST_TRANSFER_HOOK_PROGRAM_ID = "EBZDYx7599krFc4m2govwBdZcicr4GgepqC78m71nsHS";

/**
 * Creates a Token-2022 mint with transfer hook extension enabled.
 * This will initially fail when used with SDK functions because they don't support transfer hooks yet.
 * 
 * @param config Configuration for the mint
 * @returns The mint address
 */
export async function setupMintWithTransferHook(
  config: { decimals?: number } = {},
): Promise<Address> {
  const keypair = getNextKeypair();
  const instructions: IInstruction[] = [];

  const extensions: ExtensionArgs[] = [
    {
      __kind: "TransferHook",
      authority: signer.address,
      programId: address(TEST_TRANSFER_HOOK_PROGRAM_ID),
    },
  ];

  instructions.push(
    getCreateAccountInstruction({
      payer: signer,
      newAccount: keypair,
      lamports: 1e8,
      space: getMintSize(extensions),
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
  );

  // TODO: Add transfer hook initialization instruction once we have proper imports
  // This would require porting the transfer hook initialization logic from legacy SDK

  instructions.push(
    getInitializeMint2Instruction({
      mint: keypair.address,
      mintAuthority: signer.address,
      freezeAuthority: null,
      decimals: config.decimals ?? 6,
    }),
  );

  await sendTransaction(instructions);

  return keypair.address;
}

/**
 * Helper function to resolve transfer hook accounts for a token.
 * This resolves the extra accounts needed for transfer hook programs.
 * 
 * @param rpc The RPC client
 * @param mint The mint address
 * @param source Source token account
 * @param destination Destination token account  
 * @param owner Owner of the source account
 * @returns Array of account metas needed for transfer hook
 */
export async function getTransferHookAccounts(
  rpc: Rpc<GetAccountInfoApi>,
  mint: Address,
  source: Address,
  destination: Address,
  owner: Address,
): Promise<IAccountMeta[]> {
  const mintAccount = await fetchMint(rpc, mint);
  
  // Check if the mint has transfer hook extension
  const transferHook = getTransferHookExtension(mintAccount.data);
  if (!transferHook) {
    return [];
  }

  // Get the extra account metas address
  const extraAccountMetasAddress = getExtraAccountMetasAddress(mint, transferHook.programId);
  
  try {
    // Fetch the extra account metas account
    const extraAccountMetasAccount = await rpc.getAccountInfo(extraAccountMetasAddress).send();
    
    if (!extraAccountMetasAccount.value) {
      // No extra accounts needed
      return [];
    }

    // Parse the extra account metas and resolve them
    const extraAccountMetas = parseExtraAccountMetas(new Uint8Array(Buffer.from(extraAccountMetasAccount.value.data)));
    const resolvedAccounts = await resolveExtraAccountMetas(
      rpc,
      extraAccountMetas,
      transferHook.programId,
      source,
      mint,
      destination,
      owner,
      0n, // amount - extra accounts should not depend on amount
    );

    return resolvedAccounts;
  } catch (error) {
    // If we can't resolve extra accounts, return empty array
    console.warn('Failed to resolve transfer hook accounts:', error);
    return [];
  }
}

/**
 * Helper to check if a mint has transfer hook extension.
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
 * 
 * @param mint The mint address
 * @param programId The transfer hook program ID
 * @returns The extra account metas address
 */
export function getExtraAccountMetasAddress(mint: Address, programId: Address): Address {
  // This is a simplified implementation - the actual PDA derivation should use
  // the seeds defined in the transfer hook interface
  // For now, we'll use a basic derivation
  const seeds = [
    "extra-account-metas",
    mint,
  ];
  
  // Note: This is a stub - proper implementation would use findProgramAddress
  // with the correct seeds from the transfer hook interface
  return mint; // Placeholder
}

/**
 * Parse extra account metas from account data.
 * 
 * @param data The account data
 * @returns Array of extra account metas
 */
export function parseExtraAccountMetas(data: Uint8Array): any[] {
  // This is a stub implementation
  // The actual implementation would parse the TLV-encoded extra account metas
  return [];
}

/**
 * Resolve extra account metas to actual account metas.
 * 
 * @param rpc The RPC client
 * @param extraAccountMetas The extra account metas to resolve
 * @param programId The transfer hook program ID
 * @param source Source account
 * @param mint Mint account
 * @param destination Destination account
 * @param owner Owner account
 * @param amount Transfer amount
 * @returns Array of resolved account metas
 */
export async function resolveExtraAccountMetas(
  rpc: Rpc<GetAccountInfoApi>,
  extraAccountMetas: any[],
  programId: Address,
  source: Address,
  mint: Address,
  destination: Address,
  owner: Address,
  amount: bigint,
): Promise<IAccountMeta[]> {
  // This is a stub implementation
  // The actual implementation would resolve PDAs and other dynamic accounts
  // based on the extra account meta configurations
  return [];
}

/**
 * Create instruction to initialize the extra account meta list for a transfer hook program.
 * This is required for the test transfer hook program to work properly.
 * Based on the legacy SDK implementation - using exact same format.
 */
export function createInitializeExtraAccountMetaListInstruction(
  payer: Address,
  mint: Address,
): IInstruction {
  // Use the exact same implementation as legacy SDK
  const { PublicKey, SystemProgram, TransactionInstruction } = require("@solana/web3.js");
  const { ASSOCIATED_TOKEN_PROGRAM_ID } = require("@solana/spl-token");
  
  // Derive the extra account meta list PDA
  const [extraAccountMetaListPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), new PublicKey(mint).toBuffer()],
    new PublicKey(TEST_TRANSFER_HOOK_PROGRAM_ID)
  );
  
  // Derive the counter account PDA
  const [counterAccountPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), new PublicKey(mint).toBuffer()],
    new PublicKey(TEST_TRANSFER_HOOK_PROGRAM_ID)
  );

  // Create the instruction using the legacy format
  const legacyInstruction = new TransactionInstruction({
    programId: new PublicKey(TEST_TRANSFER_HOOK_PROGRAM_ID),
    keys: [
      { pubkey: new PublicKey(payer), isSigner: true, isWritable: true },
      { pubkey: extraAccountMetaListPDA, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
      { pubkey: counterAccountPDA, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(TOKEN_2022_PROGRAM_ADDRESS), isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([0x5c, 0xc5, 0xae, 0xc5, 0x29, 0x7c, 0x13, 0x03]), // InitializeExtraAccountMetaList
  });

  // Convert to IInstruction format
  return {
    programAddress: address(TEST_TRANSFER_HOOK_PROGRAM_ID),
    accounts: legacyInstruction.keys.map(key => ({
      address: key.pubkey.toString() as Address,
      role: key.isWritable 
        ? (key.isSigner ? AccountRole.WRITABLE_SIGNER : AccountRole.WRITABLE)
        : (key.isSigner ? AccountRole.READONLY_SIGNER : AccountRole.READONLY),
    })),
    data: new Uint8Array(legacyInstruction.data),
  };
}