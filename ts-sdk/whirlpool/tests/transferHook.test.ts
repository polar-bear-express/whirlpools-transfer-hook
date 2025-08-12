import { describe, it, beforeAll } from "vitest";
import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import { setupMintTETransferHook, setupAtaTE, setupMintTE } from "./utils/tokenExtensions";
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
  fetchMaybeWhirlpool
} from "@orca-so/whirlpools-client";
import assert from "assert";
import { assertAccountExists } from "@solana/kit";
import { setWhirlpoolsConfig } from "../src/config";

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
      const { poolAddress } = await createSplashPoolInstructions(
        rpc,
        mintA,
        mintB,
        1.0
      );

      const param = { tokenA: 1000000n };
      
      const { instructions, positionMint } = await openFullRangePositionInstructions(
        rpc,
        poolAddress,
        param,
        100, // slippage
        signer
      );

      // This will fail initially due to remainingAccountsInfo: null
      // but should work once transfer hook support is implemented
      await sendTransaction(instructions);
      
      // TODO: Verify position is created and liquidity is added correctly
    });

    it("should increase liquidity on existing position with transfer hook tokens", async () => {
      // Create pool and position first
      const { poolAddress } = await createSplashPoolInstructions(rpc, mintA, mintB, 1.0);
      const { positionMint } = await openFullRangePositionInstructions(
        rpc,
        poolAddress,
        { tokenA: 1000000n }
      );

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
        poolAddress,
        swapParam,
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
        poolAddress,
        swapParam,
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