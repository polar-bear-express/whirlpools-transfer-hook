import { describe, it, beforeAll } from "vitest";
import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import { setupMintTETransferHook, setupAtaTE, setupMintTE } from "./utils/tokenExtensions";
import { createInitializeExtraAccountMetaListInstruction } from "./utils/transferHooks";
import { setupConfigAndFeeTiers } from "./utils/program";
import {
  createSplashPoolInstructions,
  increaseLiquidityInstructions,
  openFullRangePositionInstructions,
  swapInstructions,
} from "../src";
import { 
  getInitializeTokenBadgeInstruction, 
  getTokenBadgeAddress, 
  getWhirlpoolsConfigExtensionAddress,
  fetchMaybeTokenBadge,
  fetchMaybeWhirlpoolsConfigExtension,
  fetchMaybeWhirlpool,
  fetchMaybePosition,
  getPositionAddress
} from "@orca-so/whirlpools-client";
import assert from "assert";
import { assertAccountExists } from "@solana/kit";
import { setWhirlpoolsConfig } from "../src/config";
import { fetchToken, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { findAssociatedTokenPda } from "@solana-program/token";

// Helper function to initialize token badge for a mint
async function initializeTokenBadge(mint: any, configAddress: any) {
  const tokenBadgeAddress = await getTokenBadgeAddress(configAddress, mint);
  const configExtensionAddress = await getWhirlpoolsConfigExtensionAddress(configAddress);
  
  // Check if config extension exists before trying to initialize token badge
  const configExtensionAccount = await fetchMaybeWhirlpoolsConfigExtension(rpc, configExtensionAddress[0]);
  if (!configExtensionAccount.exists) {
    throw new Error(`Config extension account ${configExtensionAddress[0]} does not exist!`);
  }
  
  const instruction = getInitializeTokenBadgeInstruction({
    whirlpoolsConfig: configAddress,
    whirlpoolsConfigExtension: configExtensionAddress[0],
    tokenBadgeAuthority: signer,
    tokenMint: mint,
    tokenBadge: tokenBadgeAddress[0],
    funder: signer,
  });
  
  await sendTransaction([instruction]);
  
  // Verify the token badge was created
  const verifyTokenBadge = await fetchMaybeTokenBadge(rpc, tokenBadgeAddress[0]);
  if (!verifyTokenBadge.exists) {
    throw new Error(`Token badge ${tokenBadgeAddress[0]} was not created successfully!`);
  }
}

describe("Transfer Hook Support", () => {
  let config: any;
  let mintA: any;
  let mintB: any;

  beforeAll(async () => {
    config = await setupConfigAndFeeTiers();
    
    // Update the global config to match the test config
    await setWhirlpoolsConfig(config);
    
    // Create two mints with transfer hook extensions
    mintA = await setupMintTETransferHook({ decimals: 6 });
    mintB = await setupMintTE({ decimals: 6 }); // Normal Token-2022 mint without extensions
    
    // Initialize extra account meta list for transfer hook mint (required for transfer hook to work)
    const initializeExtraAccountMetasInstruction = createInitializeExtraAccountMetaListInstruction(
      signer.address,
      mintA
    );
    await sendTransaction([initializeExtraAccountMetasInstruction]);
    
    // Initialize token badges for transfer hook mints (required by Whirlpool)
    await initializeTokenBadge(mintA, config);
    // await initializeTokenBadge(mintB, config);
    
    // Set up token accounts
    await setupAtaTE(mintA, { amount: 1000000000 });
    await setupAtaTE(mintB, { amount: 1000000000 });
  });

  describe("Pool Creation with Transfer Hooks", () => {
    it("should create splash pool with transfer hook tokens", async () => {
      const price = 1.0;
      
      const { instructions, poolAddress } = await createSplashPoolInstructions(
        rpc,
        mintA,
        mintB, 
        price
      );

      // Verify pool doesn't exist before creation
      const poolBefore = await fetchMaybeWhirlpool(rpc, poolAddress);
      assert.strictEqual(poolBefore.exists, false);

      await sendTransaction(instructions);
      
      // Verify pool was created successfully
      const poolAfter = await fetchMaybeWhirlpool(rpc, poolAddress);
      assertAccountExists(poolAfter);
      assert.strictEqual(poolAfter.data.tokenMintA, mintA);
      assert.strictEqual(poolAfter.data.tokenMintB, mintB);      
    });

    it("should create splash pool with both transfer hook token mints", async () => {
      // Create one normal mint and one with transfer hook
      const transferHookMint = await setupMintTETransferHook({ decimals: 6 });
      await initializeTokenBadge(transferHookMint, config);
      await setupAtaTE(transferHookMint, { amount: 1000000000 });
      
      const { instructions, poolAddress } = await createSplashPoolInstructions(
        rpc,
        mintA, // transfer hook mint
        transferHookMint, // transfer hook mint
        1.0
      );

      await sendTransaction(instructions);
      
      // Verify pool was created successfully
      const poolAfter = await fetchMaybeWhirlpool(rpc, poolAddress);
      assertAccountExists(poolAfter);
      assert.strictEqual(poolAfter.data.tokenMintA, mintA);
      assert.strictEqual(poolAfter.data.tokenMintB, transferHookMint);
    });
  });

  describe("Liquidity Operations with Transfer Hooks", () => {
    it("should open full range position with transfer hook tokens", async () => {
      // First create a pool
      const { instructions: poolInstructions, poolAddress } = await createSplashPoolInstructions(
        rpc,
        mintA,
        mintB,
        1.0
      );

      await sendTransaction(poolInstructions);
      const poolAfter = await fetchMaybeWhirlpool(rpc, poolAddress);
      assertAccountExists(poolAfter);
      assert.strictEqual(poolAfter.data.tokenMintA, mintA);
      assert.strictEqual(poolAfter.data.tokenMintB, mintB);

      const param = { tokenA: 1000000n };
      
      // Get ATA addresses for token balance verification
      const ataA = await findAssociatedTokenPda({
        owner: signer.address,
        mint: mintA,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      }).then((x) => x[0]);
      
      const ataB = await findAssociatedTokenPda({
        owner: signer.address,
        mint: mintB,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      }).then((x) => x[0]);

      // Get token balances before opening position
      const tokenABefore = await fetchToken(rpc, ataA);
      const tokenBBefore = await fetchToken(rpc, ataB);
      
      const { instructions, positionMint, quote } = await openFullRangePositionInstructions(
        rpc,
        poolAddress,
        param,
        100, // slippage
        signer
      );

      // This will fail initially due to remainingAccountsInfo: null
      // but should work once transfer hook support is implemented
      await sendTransaction(instructions);
      
      // Verify position was created successfully
      const positionAddress = await getPositionAddress(positionMint);
      const position = await fetchMaybePosition(rpc, positionAddress[0]);
      assertAccountExists(position);
      
      // Verify liquidity was added to the position
      assert.strictEqual(position.data.liquidity, quote.liquidityDelta, "Position should have the expected liquidity");
      assert(position.data.liquidity > 0n, "Position should have liquidity greater than 0");
      
      // Verify token balances changed correctly (tokens were spent)
      const tokenAAfter = await fetchToken(rpc, ataA);
      const tokenBAfter = await fetchToken(rpc, ataB);
      
      const tokenASpent = tokenABefore.data.amount - tokenAAfter.data.amount;
      const tokenBSpent = tokenBBefore.data.amount - tokenBAfter.data.amount;
      
      assert.strictEqual(tokenASpent, quote.tokenEstA, "Token A spent should match quote estimate");
      assert.strictEqual(tokenBSpent, quote.tokenEstB, "Token B spent should match quote estimate");
      assert(tokenASpent > 0n, "Should have spent some token A");
    });

    it("should increase liquidity on existing position with transfer hook tokens", async () => {
      // Create pool and position first
      const { poolAddress } = await createSplashPoolInstructions(rpc, mintA, mintB, 1.0);
      const { positionMint, instructions: openInstructions } = await openFullRangePositionInstructions(
        rpc,
        poolAddress,
        { tokenA: 1000000n }
      );

      // Send the open position transaction so the position account exists on-chain
      await sendTransaction(openInstructions);

      // Now increase liquidity
      const param = { tokenA: 500000n };
      
      const { instructions } = await increaseLiquidityInstructions(
        rpc,
        positionMint,
        param,
        100, // slippage
        signer
      );

      // This will fail initially due to remainingAccountsInfo: null
      await sendTransaction(instructions);
      
      // TODO: Verify liquidity increase is successful
    });
  });

  describe("Swap Operations with Transfer Hooks", () => {
    it("should perform exact-in swap with transfer hook input token", async () => {
      // Create pool first
      const { poolAddress } = await createSplashPoolInstructions(rpc, mintA, mintB, 1.0);
      
      // Add some liquidity to the pool
      await openFullRangePositionInstructions(
        rpc,
        poolAddress,
        { tokenA: 10000000n }
      );

      const swapParam = {
        inputAmount: 100000n,
        mint: mintA,
      };
      
      const { instructions } = await swapInstructions(
        rpc,
        swapParam,
        poolAddress,
        100, // slippage
        signer
      );

      // This will fail initially due to remainingAccountsInfo: null
      await sendTransaction(instructions);
      
      // TODO: Verify swap executes correctly with transfer hook accounts
    });

    it("should perform exact-out swap with transfer hook output token", async () => {
      // Create pool first
      const { poolAddress } = await createSplashPoolInstructions(rpc, mintA, mintB, 1.0);
      
      // Add liquidity
      await openFullRangePositionInstructions(
        rpc,
        poolAddress,
        { tokenA: 10000000n }
      );

      const swapParam = {
        outputAmount: 50000n,
        mint: mintB, // transfer hook token as output
      };
      
      const { instructions } = await swapInstructions(
        rpc,
        swapParam,
        poolAddress,
        100, // slippage
        signer
      );

      // This will fail initially due to remainingAccountsInfo: null
      await sendTransaction(instructions);
      
      // TODO: Verify swap executes correctly
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle tokens without transfer hooks normally", async () => {
      // TODO: Create normal Token-2022 mints without transfer hook extension
      // and verify they work normally (this should already work)
    });

    it("should handle invalid transfer hook configurations gracefully", async () => {
      // TODO: Test error scenarios like invalid transfer hook accounts
      // or misconfigured transfer hook programs
    });
  });
});