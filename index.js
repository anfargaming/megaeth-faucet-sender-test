import figlet from 'figlet';
import { ethers } from 'ethers';
import fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import blessed from 'blessed';
import contrib from 'blessed-contrib';

// ====== Configuration ======
const config = {
  rpcUrl: 'https://carrot.megaeth.com/rpc',
  chainId: 6342,
  minBalance: '0.002',
  gasBuffer: 1.2,
  refreshInterval: 15000
};

// ====== Global State ======
let provider;
let privateKeys = [];
let targetAddress = '';
let screen, grid, processBox, statusBox, exitBox, logBox;
let success = 0, failed = 0, skipped = 0;
let isShuttingDown = false;

// ====== Load Keys & Target ======
function loadFiles() {
  console.log(chalk.blue('Step 1: Loading files...'));
  try {
    if (!fs.existsSync('private_keys.txt') || !fs.existsSync('target_address.txt')) {
      throw new Error('Required input files missing');
    }
    
    privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && (line.length === 64 || line.length === 66));
    
    targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();

    if (!privateKeys.length) throw new Error('No valid private keys found');
    if (!ethers.isAddress(targetAddress)) throw new Error('Invalid target address');
    
    console.log(chalk.green(`Successfully loaded ${privateKeys.length} keys and target address: ${targetAddress}`));
    return true;
  } catch (err) {
    console.error(chalk.red('❌ File loading failed:'), err.message);
    return false;
  }
}

// ====== Terminal UI Setup ======
function initUI() {
  console.log(chalk.blue('Step 2: Initializing UI...'));
  if (!process.stdout.isTTY) {
    console.error(chalk.red('Error: Interactive terminal required'));
    process.exit(1);
  }

  try {
    screen = blessed.screen({
      smartCSR: true,
      dockBorders: true,
      fullUnicode: true,
      input: process.stdin,
      output: process.stdout,
      terminal: process.env.TERM || 'xterm-256color',
      title: 'Custom MegaETH Dashboard'
    });

    grid = new contrib.grid({ rows: 12, cols: 12, screen });

    // Process Box (Top Left)
    processBox = grid.set(0, 0, 3, 6, blessed.box, {
      label: ' Process ',
      border: { type: 'line' },
      style: { fg: 'white', border: { fg: 'cyan' }},
      content: 'Processing wallets...'
    });

    // Status Box (Middle Left)
    statusBox = grid.set(3, 0, 4, 6, blessed.box, {
      label: ' Status ',
      border: { type: 'line' },
      style: { fg: 'white', border: { fg: 'cyan' }},
      content: 'Success: 0\nFailed: 0'
    });

    // Exit Details and Key Box (Bottom Left)
    exitBox = grid.set(7, 0, 5, 6, blessed.box, {
      label: ' Screen Exit Details and Key ',
      border: { type: 'line' },
      style: { fg: 'white', border: { fg: 'cyan' }},
      content: 'Press q, Ctrl+C, or Esc to exit'
    });

    // Logs Box (Right Side)
    logBox = grid.set(0, 6, 12, 6, blessed.log, {
      label: ' Logs ',
      border: { type: 'line' },
      style: { fg: 'white', border: { fg: 'cyan' }},
      scrollable: true,
      scrollbar: { bg: 'blue' },
      tags: true
    });

    screen.key(['q', 'C-c', 'escape'], () => {
      if (!isShuttingDown) gracefulShutdown();
    });

    screen.on('render', () => console.log(chalk.green('Screen rendered successfully')));
    screen.on('error', (err) => console.error(chalk.red('Screen error:'), err));
    screen.render();
    console.log(chalk.green('UI initialized successfully'));
  } catch (err) {
    console.error(chalk.red('UI initialization failed:'), err.message);
    process.exit(1);
  }
}

// ====== Dashboard Refresh ======
function updateDashboard() {
  if (!screen) {
    console.log(chalk.yellow('No screen available for update'));
    return;
  }

  console.log(chalk.blue('Updating dashboard...'));
  statusBox.setContent(
    `Success: ${success}\nFailed: ${failed}`
  );
  screen.render();
}

// ====== Shutdown Handler ======
function gracefulShutdown(code = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(chalk.blue('Initiating shutdown with code:', code));
  try {
    if (screen) {
      screen.program.clear();
      screen.program.disableMouse();
      screen.program.showCursor();
      screen.program.normalBuffer();
      screen.destroy();
      console.log(chalk.green('Screen destroyed'));
    }
    process.stdout.write('\n');
  } catch (e) {
    console.error('Shutdown error:', e.message);
  } finally {
    console.log(chalk.green('Process exiting with code:', code));
    process.exit(code);
  }
}

// ====== Process One Wallet ======
async function processWallet(pk, index) {
  const wallet = new ethers.Wallet(pk, provider);
  const address = await wallet.getAddress();
  const spinner = ora(`Processing ${address}`).start();
  const now = new Date().toLocaleString();

  try {
    const balance = await provider.getBalance(address);
    const balanceEth = ethers.formatEther(balance);
    const minBalanceWei = ethers.parseEther(config.minBalance);

    if (balance < minBalanceWei) {
      skipped++;
      logBox.log(`{yellow-fg}⚠ ${now} | ${address} - Low balance (${balanceEth} ETH){/}`);
      updateDashboard();
      spinner.warn('Skipped');
      return;
    }

    const feeData = await provider.getFeeData();
    const gasLimit = 21000n;
    const gasCost = (gasLimit * (feeData.maxFeePerGas || feeData.gasPrice)) * BigInt(Math.floor(config.gasBuffer * 100)) / 100n;
    const amount = balance - gasCost;

    if (amount <= 0n) {
      skipped++;
      logBox.log(`{yellow-fg}⚠ ${now} | ${address} - Insufficient after gas{/}`);
      updateDashboard();
      spinner.warn('Too low after gas');
      return;
    }

    const tx = await wallet.sendTransaction({
      to: targetAddress,
      value: amount,
      gasLimit,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
    });

    const receipt = await tx.wait();
    const amountEth = ethers.formatEther(amount);

    if (receipt.status === 1) {
      success++;
      logBox.log(`{green-fg}✔ ${now} | ${amountEth} ETH sent to ${targetAddress} | ${tx.hash}{/}`);
      updateDashboard();
      spinner.succeed(`Sent ${amountEth} ETH`);
    } else {
      throw new Error('Transaction reverted');
    }
  } catch (err) {
    failed++;
    logBox.log(`{red-fg}✖ ${now} | ${address} | Error: ${err.message}{/}`);
    updateDashboard();
    spinner.fail(err.message.slice(0, 50));
  }
}

// ====== Main ======
async function main() {
  console.log(chalk.blue('Starting main execution...'));
  if (!loadFiles()) {
    gracefulShutdown(1);
    return;
  }

  provider = new ethers.JsonRpcProvider(config.rpcUrl);
  try {
    console.log(chalk.blue('Step 3: Connecting to RPC...'));
    await provider.ready;
    console.log(chalk.green('RPC connected'));
  } catch (err) {
    console.error(chalk.red('RPC connection failed:'), err.message);
    gracefulShutdown(1);
    return;
  }

  console.log(chalk.cyan(figlet.textSync('MEGA ETH')));
  console.log(chalk.green(`🚀 Consolidating to ${targetAddress}`));
  console.log(`🔑 Wallets: ${privateKeys.length}\n`);

  initUI();

  try {
    console.log(chalk.blue('Step 4: Starting wallet processing...'));
    for (let i = 0; i < privateKeys.length; i++) {
      console.log(chalk.blue(`Processing wallet ${i + 1}/${privateKeys.length}`));
      await processWallet(privateKeys[i], i);
    }

    logBox.log('{green-fg}\n✨ All transactions completed!{/}');
    // Keep the screen alive; no automatic shutdown
  } catch (err) {
    console.error(chalk.red('Processing error:'), err.message);
    gracefulShutdown(1);
  }
}

// ====== Global Error Handling ======
process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
  if (!isShuttingDown) gracefulShutdown(1);
});

process.on('unhandledRejection', reason => {
  console.error('Unhandled Rejection:', reason);
  if (!isShuttingDown) gracefulShutdown(1);
});

process.on('SIGTERM', () => gracefulShutdown(0));
process.on('SIGINT', () => gracefulShutdown(0));

// ====== Start ======
console.log(chalk.blue('Script starting...'));
main();

// Ensure the event loop keeps running
if (screen) {
  screen.on('idle', () => {
    screen.render(); // Keep rendering to maintain UI
  });
  screen.appendTo(process.stdout); // Ensure screen is attached to output
}
