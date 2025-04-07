const fs = require("fs");
const { ethers } = require("ethers");
const chalk = require("chalk");
const ora = require("ora");
require("dotenv").config();

// RPC endpoints for MEGA Testnet
const RPC_ENDPOINTS = [
    'https://carrot.megaeth.com/rpc',
    'https://rpc.testnet.megaeth.com',
    'https://testnet.megaeth.io/rpc'
];

const CHAIN_ID = 6342;
const GAS_LIMIT = 21000;
const GAS_BUFFER = 0.001; // ETH reserved for gas

const MAX_FEE_PER_GAS = ethers.parseUnits("0.0025", "gwei");
const MAX_PRIORITY_FEE = ethers.parseUnits("0.001", "gwei");

// Load target address
const targetAddress = fs.readFileSync("target_address.txt", "utf8").trim();
if (!ethers.isAddress(targetAddress)) {
    console.error(chalk.red("❌ Invalid target address in target_address.txt"));
    process.exit(1);
}

// Load private keys
const privateKeys = fs.readFileSync("private_keys.txt", "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

if (privateKeys.length === 0) {
    console.error(chalk.red("❌ No private keys found in private_keys.txt"));
    process.exit(1);
}

// Connect to first working RPC
async function connectProvider() {
    for (const url of RPC_ENDPOINTS) {
        const provider = new ethers.JsonRpcProvider(url);
        try {
            await provider.getBlockNumber();
            console.log(chalk.green(`✅ Connected to ${url}`));
            return provider;
        } catch (err) {
            console.log(chalk.yellow(`⚠️  Failed to connect to ${url}`));
        }
    }
    throw new Error("Could not connect to any RPC endpoints.");
}

// Get balance in ETH
async function getBalance(provider, address) {
    const balanceWei = await provider.getBalance(address);
    return Number(ethers.formatEther(balanceWei));
}

// Transfer ETH from wallet to target address
async function transferETH(provider, privateKey) {
    try {
        const wallet = new ethers.Wallet(privateKey, provider);
        const sender = wallet.address;

        console.log(chalk.cyan(`\n🔐 Processing wallet: ${sender}`));
        const balance = await getBalance(provider, sender);
        console.log(chalk.blue(`💰 Balance: ${balance} ETH`));

        if (balance <= 0) {
            console.log(chalk.gray("⏩ Skipping - zero balance"));
            return false;
        }

        const amountToSend = balance - GAS_BUFFER;
        if (amountToSend <= 0) {
            console.log(chalk.gray("⏩ Skipping - insufficient balance after gas buffer"));
            return false;
        }

        const nonce = await provider.getTransactionCount(sender);
        const tx = {
            to: targetAddress,
            value: ethers.parseEther(amountToSend.toFixed(6)),
            nonce,
            gasLimit: GAS_LIMIT,
            maxFeePerGas: MAX_FEE_PER_GAS,
            maxPriorityFeePerGas: MAX_PRIORITY_FEE,
            chainId: CHAIN_ID,
            type: 2,
        };

        const spinner = ora("⛽ Signing & sending transaction...").start();
        const signedTx = await wallet.signTransaction(tx);
        const txHash = await provider.sendTransaction(signedTx);
        spinner.succeed(`✅ Sent: ${txHash.hash}`);
        console.log(chalk.green(`🔎 Explorer: https://megaexplorer.xyz/tx/${txHash.hash}`));

        const receipt = await provider.waitForTransaction(txHash.hash, 1, 300000); // 300s timeout
        console.log(chalk.green(`📦 Confirmed in block ${receipt.blockNumber}`));
        return true;
    } catch (err) {
        console.log(chalk.red(`❌ Error: ${err.message}`));
        return false;
    }
}

// Run main flow
(async () => {
    console.log(chalk.cyan.bold(`\n🚀 Starting MEGA ETH Consolidation`));
    console.log(`📌 Chain ID: ${CHAIN_ID}`);
    console.log(`🎯 Target Address: ${targetAddress}`);
    console.log(`🔑 Wallets to process: ${privateKeys.length}`);

    const provider = await connectProvider();

    let success = 0;
    let failed = 0;

    for (let i = 0; i < privateKeys.length; i++) {
        console.log(chalk.yellow(`\n[${i + 1}/${privateKeys.length}]`));
        const ok = await transferETH(provider, privateKeys[i]);
        if (ok) success++;
        else failed++;
        await new Promise(res => setTimeout(res, 1000));
    }

    console.log(chalk.magentaBright(`\n✨ Done! Success: ${success}, Failed: ${failed}\n`));
})();
