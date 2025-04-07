import figlet from 'figlet';
import { ethers } from 'ethers';
import fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import cliProgress from 'cli-progress';

// ===== Configuration =====
const CONFIG = {
  rpcUrl: 'https://carrot.megaeth.com/rpc',
  chainId: 6342,
  minBalance: '0.002', // Minimum ETH balance to process
  gasBuffer: 1.2, // 20% gas buffer
  logFile: 'transactions.log'
};

// ===== State Management =====
let provider;
let privateKeys = [];
let targetAddress = '';
const results = {
  success: 0,
  failed: 0,
  skipped: 0,
  totalETH: 0
};

// ===== Initialize =====
function initialize() {
  try {
    privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();

    if (!privateKeys.length) throw new Error('No private keys found');
    if (!ethers.isAddress(targetAddress)) throw new Error('Invalid target address');
    
    return true;
  } catch (err) {
    console.error(chalk.red('Initialization failed:'), err.message);
    return false;
  }
}

// ===== Process Wallet =====
async function processWallet(pk, index) {
  const wallet = new ethers.Wallet(pk, provider);
  const address = wallet.address;
  const spinner = ora(`Processing ${index + 1}/${privateKeys.length}: ${address}`).start();

  try {
    // Check balance
    const balance = await provider.getBalance(address);
    const balanceEth = ethers.formatEther(balance);
    const minBalanceWei = ethers.parseEther(CONFIG.minBalance);

    if (balance < minBalanceWei) {
      results.skipped++;
      spinner.warn(`Skipped (low balance: ${balanceEth} ETH)`);
      logTransaction(address, balanceEth, 'Skipped');
      return;
    }

    // Estimate gas with buffer
    const feeData = await provider.getFeeData();
    const gasEstimate = await provider.estimateGas({
      to: targetAddress,
      from: address
    });

    const gasCost = (gasEstimate * (feeData.maxFeePerGas || feeData.gasPrice)) * CONFIG.gasBuffer;
    const amount = balance - gasCost;

    if (amount <= 0n) {
      results.skipped++;
      spinner.warn(`Skipped (insufficient after gas)`);
      logTransaction(address, balanceEth, 'Skipped');
      return;
    }

    // Send transaction
    const tx = await wallet.sendTransaction({
      to: targetAddress,
      value: amount,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      gasLimit: gasEstimate
    });

    const receipt = await tx.wait();
    const amountEth = ethers.formatEther(amount);

    if (receipt.status === 1) {
      results.success++;
      results.totalETH += parseFloat(amountEth);
      spinner.succeed(`Sent ${amountEth} ETH`);
      logTransaction(address, amountEth, 'Success', tx.hash);
    } else {
      results.failed++;
      spinner.fail('Transaction failed');
      logTransaction(address, balanceEth, 'Failed', tx.hash);
    }

  } catch (err) {
    results.failed++;
    spinner.fail(err.message);
    logTransaction(address, '-', 'Failed');
  }
}

// ===== Log Transaction =====
function logTransaction(address, amount, status, txHash = '-') {
  const logEntry = {
    timestamp: new Date().toISOString(),
    address,
    amount,
    status,
    txHash
  };

  fs.appendFileSync(CONFIG.logFile, JSON.stringify(logEntry) + '\n');
}

// ===== Main Execution =====
async function main() {
  if (!initialize()) return;

  provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
  await provider.ready;

  console.log(chalk.cyan(figlet.textSync('MEGA ETH')));
  console.log(chalk.green(`🚀 Starting ETH consolidation to ${targetAddress}`));
  console.log(`🔗 RPC: ${CONFIG.rpcUrl}`);
  console.log(`🔑 Wallets: ${privateKeys.length}\n`);

  // Initialize progress bar
  const progressBar = new cliProgress.SingleBar({
    format: '{bar} | {percentage}% | {value}/{total} wallets',
    barCompleteChar: '█',
    barIncompleteChar: '░'
  }, cliProgress.Presets.shades_classic);

  progressBar.start(privateKeys.length, 0);

  // Process wallets sequentially
  for (let i = 0; i < privateKeys.length; i++) {
    await processWallet(privateKeys[i], i);
    progressBar.update(i + 1);
  }

  progressBar.stop();

  // Final report
  console.log(chalk.green('\n✨ All transactions completed!'));
  console.log(`✅ Success: ${results.success}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`⚠ Skipped: ${results.skipped}`);
  console.log(`💰 Total ETH Sent: ${results.totalETH.toFixed(6)}`);
  console.log(`📝 Transaction log saved to ${CONFIG.logFile}`);
}

// ===== Error Handling =====
process.on('uncaughtException', (err) => {
  console.error(chalk.red('Uncaught Exception:'), err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('Unhandled Rejection:'), reason);
  process.exit(1);
});

// Start
main().catch(err => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});
