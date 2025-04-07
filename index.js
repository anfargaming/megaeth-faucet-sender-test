import { ethers } from 'ethers';
import fs from 'fs';
import chalk from 'chalk';
import cluster from 'cluster';
import os from 'os';

// Configuration
const config = {
  rpcUrl: 'https://carrot.megaeth.com/rpc',
  chainId: 6342,
  minBalance: '0.002', // ETH
  maxWorkers: os.cpus().length
};

// State
let provider;
let privateKeys = [];
let targetAddress = '';
let success = 0, failed = 0, skipped = 0;

// Initialize
function loadFiles() {
  try {
    privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();
    return true;
  } catch (err) {
    console.error(chalk.red('Error loading files:'), err.message);
    return false;
  }
}

// Process wallet (simplified without UI)
async function processWallet(pk) {
  const wallet = new ethers.Wallet(pk, provider);
  const address = await wallet.getAddress();

  try {
    const balance = await provider.getBalance(address);
    const balanceEth = ethers.formatEther(balance);
    const minBalanceWei = ethers.parseEther(config.minBalance);

    if (balance < minBalanceWei) {
      skipped++;
      console.log(chalk.yellow(`⚠ ${address} - Low balance (${balanceEth} ETH)`));
      return;
    }

    const feeData = await provider.getFeeData();
    const gasEstimate = await provider.estimateGas({
      to: targetAddress,
      from: address
    });

    const gasCost = gasEstimate * (feeData.maxFeePerGas || feeData.gasPrice);
    const amount = balance - gasCost;

    if (amount <= 0n) {
      skipped++;
      console.log(chalk.yellow(`⚠ ${address} - Insufficient balance after gas`));
      return;
    }

    const tx = await wallet.sendTransaction({
      to: targetAddress,
      value: amount,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      gasLimit: gasEstimate
    });

    const receipt = await tx.wait();
    if (receipt.status === 1) {
      success++;
      console.log(chalk.green(`✔ ${address} - Sent ${ethers.formatEther(amount)} ETH`));
    } else {
      failed++;
      console.log(chalk.red(`✖ ${address} - Transaction failed`));
    }
  } catch (err) {
    failed++;
    console.log(chalk.red(`✖ ${address} - Error: ${err.message}`));
  }
}

// Cluster worker
async function workerProcess() {
  const workerId = cluster.worker.id;
  const keysPerWorker = Math.ceil(privateKeys.length / config.maxWorkers);
  const startIdx = (workerId - 1) * keysPerWorker;
  const endIdx = Math.min(startIdx + keysPerWorker, privateKeys.length);

  console.log(chalk.blue(`Worker ${workerId} processing ${endIdx - startIdx} wallets`));

  for (let i = startIdx; i < endIdx; i++) {
    await processWallet(privateKeys[i]);
  }

  process.send({ success, failed, skipped });
}

// Main process
async function main() {
  if (!loadFiles()) process.exit(1);

  provider = new ethers.JsonRpcProvider(config.rpcUrl);
  await provider.ready;

  console.log(chalk.green(`🚀 Starting ETH consolidation to ${targetAddress}`));
  console.log(`🔗 RPC: ${config.rpcUrl}`);
  console.log(`🔑 Wallets: ${privateKeys.length}`);
  console.log(`👷 Workers: ${config.maxWorkers}\n`);

  if (cluster.isPrimary) {
    const startTime = Date.now();

    // Fork workers
    for (let i = 0; i < config.maxWorkers; i++) {
      cluster.fork();
    }

    // Handle results
    let completedWorkers = 0;
    cluster.on('message', (worker, stats) => {
      success += stats.success;
      failed += stats.failed;
      skipped += stats.skipped;
      completedWorkers++;

      if (completedWorkers === config.maxWorkers) {
        const duration = (Date.now() - startTime) / 1000;
        console.log(chalk.green('\n✨ All transactions completed!'));
        console.log(`⏱ Duration: ${duration.toFixed(2)} seconds`);
        console.log(`✅ Success: ${success}`);
        console.log(`❌ Failed: ${failed}`);
        console.log(`⚠ Skipped: ${skipped}`);
        process.exit(0);
      }
    });

    // Handle worker exits
    cluster.on('exit', (worker, code) => {
      if (code !== 0) {
        console.log(chalk.red(`Worker ${worker.process.pid} exited with code ${code}`));
      }
    });

  } else {
    await workerProcess();
    process.exit(0);
  }
}

// Error handling
process.on('uncaughtException', (err) => {
  console.error(chalk.red('Uncaught Exception:'), err.message);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error(chalk.red('Unhandled Rejection:'), err.message);
  process.exit(1);
});

// Start
main().catch(err => {
  console.error(chalk.red('Fatal error:'), err.message);
  process.exit(1);
});
