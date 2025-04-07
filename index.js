import figlet from 'figlet';
import { ethers } from 'ethers';
import fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import blessed from 'blessed';
import contrib from 'blessed-contrib';
import cliProgress from 'cli-progress';

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
let screen, grid, logBox, donut, line, table;
let ethFlowData = { x: [], y: [] };
let success = 0, failed = 0, skipped = 0;
let progressBar;
let isShuttingDown = false;

// ====== Load Keys & Target ======
function loadFiles() {
  try {
    if (!fs.existsSync('private_keys.txt') || !fs.existsSync('target_address.txt')) {
      throw new Error('Required input files missing');
    }
    
    privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && (line.length === 64 || line.length === 66)); // Basic key validation
    
    targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();

    if (!privateKeys.length) throw new Error('No valid private keys found');
    if (!ethers.isAddress(targetAddress)) throw new Error('Invalid target address');
    return true;
  } catch (err) {
    console.error(chalk.red('❌ Initialization failed:'), err.message);
    return false;
  }
}

// ====== Terminal UI Setup ======
function initUI() {
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
      terminal: process.env.TERM || 'xterm-256color'
    });

    grid = new contrib.grid({ rows: 12, cols: 12, screen });

    donut = grid.set(0, 0, 4, 4, contrib.donut, {
      label: ' Status ',
      radius: 16,
      arcWidth: 8,
      data: [
        { label: 'Success', percent: 0, color: 'green' },
        { label: 'Failed', percent: 0, color: 'red' },
        { label: 'Skipped', percent: 0, color: 'yellow' }
      ]
    });

    line = grid.set(0, 4, 4, 8, contrib.line, {
      label: ' ETH Flow ',
      showLegend: true,
      legend: { width: 12 }
    });

    table = grid.set(4, 0, 4, 12, contrib.table, {
      label: ' Wallet Balances ',
      columnWidth: [25, 15, 12, 18, 14],
      columnSpacing: 2,
      interactive: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      columns: ['Address', 'Balance', 'Status', 'Tx Hash', 'Time']
    });

    logBox = grid.set(8, 0, 4, 12, blessed.log, {
      label: ' Live Logs ',
      border: { type: 'line' },
      style: { fg: 'white', border: { fg: 'cyan' }},
      scrollable: true,
      scrollbar: { bg: 'blue' },
      tags: true
    });

    screen.key(['q', 'C-c', 'escape'], () => {
      if (!isShuttingDown) gracefulShutdown();
    });

    screen.on('resize', () => screen.render());
  } catch (err) {
    console.error(chalk.red('UI initialization failed:'), err.message);
    process.exit(1);
  }
}

// ====== Dashboard Refresh ======
function updateDashboard() {
  if (!screen) return;

  donut.setData([
    { label: 'Success', percent: (success / privateKeys.length) * 100 || 0, color: 'green' },
    { label: 'Failed', percent: (failed / privateKeys.length) * 100 || 0, color: 'red' },
    { label: 'Skipped', percent: (skipped / privateKeys.length) * 100 || 0, color: 'yellow' }
  ]);

  line.setData([{
    title: 'ETH Sent',
    x: ethFlowData.x,
    y: ethFlowData.y,
    style: { line: 'green' }
  }]);

  screen.render();
}

// ====== Shutdown Handler ======
function gracefulShutdown(code = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  try {
    if (progressBar) {
      progressBar.stop();
    }
    if (screen) {
      screen.program.clear();
      screen.program.disableMouse();
      screen.program.showCursor();
      screen.program.normalBuffer();
      screen.destroy();
    }
    process.stdout.write('\n');
  } catch (e) {
    console.error('Shutdown error:', e.message);
  } finally {
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
      logBox.log(`{yellow-fg}⚠ ${address} - Low balance (${balanceEth} ETH){/}`);
      table.setData({
        headers: ['Address', 'Balance', 'Status', 'Tx Hash', 'Time'],
        data: [...(table.rows || []), [address, balanceEth, 'Skipped', '-', now]]
      });
      spinner.warn('Skipped');
      return;
    }

    const feeData = await provider.getFeeData();
    const gasLimit = 21000n; // Standard ETH transfer gas limit
    const gasCost = (gasLimit * (feeData.maxFeePerGas || feeData.gasPrice)) * BigInt(Math.floor(config.gasBuffer * 100)) / 100n;
    const amount = balance - gasCost;

    if (amount <= 0n) {
      skipped++;
      logBox.log(`{yellow-fg}⚠ ${address} - Insufficient after gas{/}`);
      table.setData({
        headers: ['Address', 'Balance', 'Status', 'Tx Hash', 'Time'],
        data: [...(table.rows || []), [address, balanceEth, 'Skipped', '-', now]]
      });
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
      ethFlowData.x.push(index.toString());
      ethFlowData.y.push(Number(amountEth));
      logBox.log(`{green-fg}✔ ${now} | ${amountEth} ETH | ${tx.hash}{/}`);
      table.setData({
        headers: ['Address', 'Balance', 'Status', 'Tx Hash', 'Time'],
        data: [...(table.rows || []), [address, amountEth, 'Success', tx.hash.slice(0, 12) + '...', now]]
      });
      spinner.succeed(`Sent ${amountEth} ETH`);
    } else {
      throw new Error('Transaction reverted');
    }
  } catch (err) {
    failed++;
    logBox.log(`{red-fg}✖ ${now} | Error: ${err.message}{/}`);
    table.setData({
      headers: ['Address', 'Balance', 'Status', 'Tx Hash', 'Time'],
      data: [...(table.rows || []), [address, '-', 'Failed', '-', now]]
    });
    spinner.fail(err.message.slice(0, 50));
  } finally {
    updateDashboard();
  }
}

// ====== Main ======
async function main() {
  if (!loadFiles()) {
    gracefulShutdown(1);
    return;
  }

  provider = new ethers.JsonRpcProvider(config.rpcUrl);
  try {
    await provider.ready;
  } catch (err) {
    console.error(chalk.red('RPC connection failed:'), err.message);
    gracefulShutdown(1);
    return;
  }

  console.log(chalk.cyan(figlet.textSync('MEGA ETH')));
  console.log(chalk.green(`🚀 Consolidating to ${targetAddress}`));
  console.log(`🔑 Wallets: ${privateKeys.length}\n`);

  initUI();

  progressBar = new cliProgress.SingleBar({
    format: '{bar} | {percentage}% | {value}/{total} wallets',
    barCompleteChar: '█',
    barIncompleteChar: '░'
  }, cliProgress.Presets.shades_classic);

  progressBar.start(privateKeys.length, 0);

  try {
    for (let i = 0; i < privateKeys.length; i++) {
      await processWallet(privateKeys[i], i);
      progressBar.update(i + 1);
    }

    progressBar.stop();
    logBox.log('{green-fg}\n✨ All transactions completed!{/}');
    setTimeout(() => gracefulShutdown(0), 4000);
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
main();
