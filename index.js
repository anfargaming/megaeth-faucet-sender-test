const blessed = require('blessed');
const contrib = require('blessed-contrib');
const chalk = require('chalk');

const screen = blessed.screen();
const grid = new contrib.grid({ rows: 12, cols: 12, screen });

const logBox = grid.set(0, 0, 6, 12, blessed.log, {
  label: 'Transaction Logs',
  tags: true,
  border: { type: 'line' },
  style: { fg: 'green', border: { fg: 'cyan' } },
  scrollable: true,
  alwaysScroll: true,
  scrollbar: { ch: ' ', track: { bg: 'gray' }, style: { bg: 'green' } }
});

const walletTable = grid.set(6, 0, 4, 12, contrib.table, {
  label: 'Wallet Status',
  keys: true,
  fg: 'green',
  selectedFg: 'white',
  selectedBg: 'blue',
  interactive: true,
  columnSpacing: 2,
  columnWidth: [18, 12, 12, 12, 12, 30],
  border: { type: 'line' }
});

const finalStatusBox = grid.set(10, 0, 2, 12, blessed.box, {
  label: 'Final Status',
  tags: true,
  border: { type: 'line' },
  style: {
    fg: 'green',
    border: { fg: 'cyan' }
  }
});

const dashboard = {
  log: (msg) => logBox.log(msg),
  updateWalletTable: (data) => {
    const headers = ['Address', 'Current', 'Transfer', 'Status', 'Remain', 'Info'];
    const rows = Array.isArray(data)
      ? data.map(w =>
          [
            w.address.slice(0, 6) + '...' + w.address.slice(-4),
            w.balance,
            w.transfer,
            w.status,
            w.remaining,
            w.info
          ]
        )
      : [];

    walletTable.setData({ headers, data: rows });
    screen.render();
  },
  updateFinalStatus: ({ success, failed, skipped, status }) => {
    finalStatusBox.setContent(
      `{bold}Total Success:{/bold} ${success}\n` +
      `{bold}Total Failed:{/bold} ${failed}\n` +
      `{bold}Total Skipped:{/bold} ${skipped}\n` +
      `{bold}Final Status:{/bold} ${status}`
    );
    screen.render();
  },
  showExitMessage: () => {
    dashboard.log(chalk.gray("\nPress 'q' or Ctrl+C to exit"));
  }
};

// Example simulation
dashboard.log('{green-fg}✓{/green-fg} Connected to https://carrot.megaeth.com/rpc');
dashboard.log('{cyan-fg}?{/cyan-fg} Found 3 wallets to process\n');

dashboard.updateWalletTable([
  {
    address: '0xf472FA9830B230C9BdB50c31A00a4Fb885D8050c',
    balance: '0.001000',
    transfer: '0.000000',
    status: '$0.001000',
    remaining: '$0.001000',
    info: 'Low balance'
  },
  {
    address: '0x46B1dBe930C9BdB50c31A00a4Fb885D892348284',
    balance: '0.001000',
    transfer: '0.000000',
    status: '$0.001000',
    remaining: '$0.001000',
    info: 'Low balance'
  }
]);

dashboard.updateFinalStatus({
  success: 0,
  failed: 0,
  skipped: 2,
  status: 'Processing...'
});

dashboard.showExitMessage();

// Manual exit controls
screen.key(['q', 'C-c'], function () {
  return process.exit(0);
});

screen.render();
