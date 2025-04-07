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

// ====== Load Keys & Target ======
function loadFiles() {
  try {
    privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
      .split('\n').map(line => line.trim()).filter(Boolean);
    targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();

    if (!privateKeys.length) throw new Error('No private keys found');
    if (!ethers.isAddress(targetAddress)) throw new Error('Invalid target address');
    return true;
  } catch (err) {
    console.error(chalk.red('❌ Initialization failed:'), err.message);
    return false;
  }
}

// ====== Terminal UI Setup ======
function initUI() {
  screen = blessed.screen({ smartCSR: true, dockBorders: true });
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
    interactive: true
  });

  logBox = grid.set(8, 0, 4, 12, blessed.log, {
    label: ' Live Logs ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'cyan' }},
    scrollable: true
  });

  screen.key(['q', 'C-c', 'escape'], gracefulShutdown);
}

// ====== Dashboard Refresh ======
function updateDashboard() {
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
function gracefulShutdown() {
  try {
    screen && screen.destroy();
    progressBar && progressBar.stop();
  } catch (e) {
    console.error('Shutdown error:', e.message);
  } finally {
    process.exit(0);
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
      logBox.log(`⚠ ${address} - Low balance (${balanceEth} ETH)`);
      table.rows.push([address, balanceEth, 'Skipped', '-', now]);
      spinner.warn('Skipped');
      return;
    }

    const feeData = await provider.getFeeData();
    const gasEstimate = await provider.estimateGas({
      to: targetAddress,
      from: address,
      value: balance - (feeData.maxFeePerGas * 21000n)
    });

    const gasCost = gasEstimate * (feeData.maxFeePerGas || feeData.gasPrice) * BigInt(Math.floor(config.gasBuffer * 100)) / 100n;
    const amount = balance - gasCost;

    if (amount <= 0n) {
      skipped++;
      logBox.log(`⚠ ${address} - Insufficient after gas`);
      table.rows.push([address, balanceEth, 'Skipped', '-', now]);
      spinner.warn('Too low after gas');
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
    const amountEth = ethers.formatEther(amount);

    if (receipt.status === 1) {
      success++;
      ethFlowData.x.push(index.toString());
      ethFlowData.y.push(Number(amountEth));
      logBox.log(chalk.green(`✔ ${now} | ${amountEth} ETH | ${tx.hash}`));
      table.rows.push([address, amountEth, 'Success', tx.hash.slice(0, 12) + '...', now]);
      spinner.succeed(`Sent ${amountEth} ETH`);
    } else {
      failed++;
      logBox.log(chalk.red(`✖ ${now} | Tx failed`));
      table.rows.push([address, balanceEth, 'Failed', tx.hash.slice(0, 12) + '...', now]);
      spinner.fail('Failed');
    }

  } catch (err) {
    failed++;
    logBox.log(chalk.red(`✖ ${now} | Error: ${err.message}`));
    table.rows.push([address, '-', 'Failed', '-', now]);
    spinner.fail(err.message);
  } finally {
    updateDashboard();
  }
}

// ====== Main ======
async function main() {
  if (!loadFiles()) return;

  provider = new ethers.JsonRpcProvider(config.rpcUrl);
  await provider.ready;

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

  for (let i = 0; i < privateKeys.length; i++) {
    await processWallet(privateKeys[i], i);
    progressBar.update(i + 1);
  }

  progressBar.stop();
  logBox.log(chalk.green('\n✨ All transactions completed!'));
  setTimeout(gracefulShutdown, 4000);
}

// ====== Global Error Handling ======
process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown();
});

process.on('unhandledRejection', reason => {
  console.error('Unhandled Rejection:', reason);
  gracefulShutdown();
});

// ====== Start ======
main();
