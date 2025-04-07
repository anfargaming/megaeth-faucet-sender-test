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
    // Validate files exist
    if (!fs.existsSync('private_keys.txt') {
      throw new Error('private_keys.txt not found');
    }
    if (!fs.existsSync('target_address.txt')) {
      throw new Error('target_address.txt not found');
    }

    // Load and validate private keys
    privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => {
        // Validate private key format (64 hex chars, optionally with 0x prefix)
        const isValid = /^(0x)?[0-9a-fA-F]{64}$/.test(line);
        if (!isValid) {
          console.warn(chalk.yellow(`Invalid private key format: ${line.slice(0, 8)}...`));
        }
        return isValid;
      });

    // Load and validate target address
    targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();
    if (!ethers.isAddress(targetAddress)) {
      throw new Error('Invalid target address format');
    }

    if (!privateKeys.length) {
      throw new Error('No valid private keys found');
    }

    console.log(chalk.green(`✓ Loaded ${privateKeys.length} valid private keys`));
    console.log(chalk.green(`✓ Target address: ${targetAddress}`));
    return true;
  } catch (err) {
    console.error(chalk.red('❌ Initialization failed:'), err.message);
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

    // Get fee data
    const feeData = await provider.getFeeData();
    if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
      throw new Error('Could not get fee data from provider');
    }

    // Estimate gas with buffer
    const gasEstimate = 21000n; // Standard transfer gas limit
    const gasCost = (gasEstimate * feeData.maxFeePerGas * CONFIG.gasBuffer * 100n) / 100n;
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
      spinner.succeed(`Sent ${amountEth} ETH (Tx: ${tx.hash.slice(0, 8)}...)`);
      logTransaction(address, amountEth, 'Success', tx.hash);
    } else {
      throw new Error('Transaction reverted');
    }

  } catch (err) {
    results.failed++;
    spinner.fail(err.message.split('\n')[0].slice(0, 50)); // Truncate long error messages
    logTransaction(address, '-', 'Failed', err.message);
  }
}

// ===== Log Transaction =====
function logTransaction(address, amount, status, txHash = '-') {
  const logEntry = {
    timestamp: new Date().toISOString(),
    address,
    amount: typeof amount === 'string' ? amount : String(amount),
    status,
    txHash: typeof txHash === 'string' ? txHash : String(txHash)
  };

  fs.appendFileSync(CONFIG.logFile, JSON.stringify(logEntry) + '\n');
}

// ===== Main Execution =====
async function main() {
  console.log(chalk.blue('Starting MEGA ETH consolidation...'));

  if (!initialize()) {
    process.exit(1);
  }

  try {
    provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
    await provider.ready;
    console.log(chalk.green(`✓ Connected to ${CONFIG.rpcUrl}`));
  } catch (err) {
    console.error(chalk.red('❌ RPC connection failed:'), err.message);
    process.exit(1);
  }

  console.log(chalk.cyan(figlet.textSync('MEGA ETH')));
  console.log(chalk.green(`🚀 Starting ETH consolidation to ${targetAddress}`));
  console.log(`🔗 RPC: ${CONFIG.rpcUrl}`);
  console.log(`🔑 Wallets: ${privateKeys.length}`);
  console.log(`⏳ Estimated time: ~${Math.ceil(privateKeys.length * 1.5)} seconds\n`);

  // Initialize progress bar
  const progressBar = new cliProgress.SingleBar({
    format: '{bar} | {percentage}% | {value}/{total} wallets | ETA: {eta}s',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true
  }, cliProgress.Presets.shades_classic);

  progressBar.start(privateKeys.length, 0);

  // Process wallets sequentially
  for (let i = 0; i < privateKeys.length; i++) {
    try {
      await processWallet(privateKeys[i], i);
    } catch (err) {
      console.error(chalk.red(`❌ Error processing wallet ${i + 1}:`), err.message);
    } finally {
      progressBar.update(i + 1);
    }
  }

  progressBar.stop();

  // Final report
  console.log(chalk.green('\n✨ All transactions completed!'));
  console.log(`✅ Success: ${results.success}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`⚠ Skipped: ${results.skipped}`);
  console.log(`💰 Total ETH Sent: ${results.totalETH.toFixed(6)}`);
  console.log(`📝 Transaction log saved to ${CONFIG.logFile}`);

  // Summary with percentages
  const totalProcessed = results.success + results.failed;
  if (totalProcessed > 0) {
    console.log(`\n📊 Success rate: ${((results.success / totalProcessed) * 100).toFixed(1)}%`);
  }
}

// ===== Error Handling =====
process.on('uncaughtException', (err) => {
  console.error(chalk.red('⚠ Uncaught Exception:'), err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('⚠ Unhandled Rejection:'), reason);
  process.exit(1);
});

// Start
main().catch(err => {
  console.error(chalk.red('⚠ Fatal error:'), err.message);
  process.exit(1);
});
