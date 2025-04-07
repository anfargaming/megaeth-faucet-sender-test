import os
import time
import csv
import tkinter as tk
from tkinter import ttk, scrolledtext
from concurrent.futures import ThreadPoolExecutor
from web3 import Web3
from web3.exceptions import TransactionNotFound
from dotenv import load_dotenv
import threading
from PIL import Image, ImageTk

load_dotenv()

class MegaEthSenderGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("MEGA ETH Sender Pro")
        self.root.geometry("900x700")
        self.root.configure(bg="#2c3e50")

        self.setup_ui()
        self.sender = MegaEthSender(self.update_ui_callback)

    def setup_ui(self):
        header_frame = tk.Frame(self.root, bg="#3498db", height=100)
        header_frame.pack(fill="x", padx=10, pady=10)

        try:
            img = Image.open("logo.png").resize((80, 80))
            self.logo = ImageTk.PhotoImage(img)
            logo_label = tk.Label(header_frame, image=self.logo, bg="#3498db")
            logo_label.pack(side="left", padx=20)
        except:
            pass

        title = tk.Label(header_frame, text="MEGA ETH Sender Pro", 
                         font=("Helvetica", 20, "bold"), 
                         fg="white", bg="#3498db")
        title.pack(side="left", pady=20)

        info_frame = tk.Frame(self.root, bg="#34495e", padx=10, pady=10)
        info_frame.pack(fill="x", padx=10, pady=5)

        tk.Label(info_frame, text="Network:", font=("Helvetica", 10), 
                 fg="white", bg="#34495e").pack(side="left")
        self.network_label = tk.Label(info_frame, text="MEGA Testnet (Chain ID: 6342)", 
                                      font=("Helvetica", 10, "bold"), 
                                      fg="#2ecc71", bg="#34495e")
        self.network_label.pack(side="left", padx=5)

        progress_frame = tk.Frame(self.root, bg="#2c3e50")
        progress_frame.pack(fill="x", padx=10, pady=10)

        self.progress = ttk.Progressbar(progress_frame, orient="horizontal", 
                                        length=400, mode="determinate")
        self.progress.pack(side="left", expand=True)

        self.status_label = tk.Label(progress_frame, text="Ready", 
                                     font=("Helvetica", 10), 
                                     fg="white", bg="#2c3e50")
        self.status_label.pack(side="left", padx=10)

        console_frame = tk.Frame(self.root, bg="#2c3e50")
        console_frame.pack(fill="both", expand=True, padx=10, pady=5)

        self.console = scrolledtext.ScrolledText(console_frame, 
                                                 width=100, 
                                                 height=20,
                                                 font=("Consolas", 10),
                                                 bg="#1e272e",
                                                 fg="#ecf0f1",
                                                 insertbackground="white")
        self.console.pack(fill="both", expand=True)

        button_frame = tk.Frame(self.root, bg="#2c3e50")
        button_frame.pack(fill="x", padx=10, pady=10)

        self.start_btn = tk.Button(button_frame, text="Start Sending", 
                                   command=self.start_sending,
                                   font=("Helvetica", 12),
                                   bg="#27ae60", fg="white",
                                   activebackground="#2ecc71",
                                   activeforeground="white")
        self.start_btn.pack(side="left", padx=5)

        tk.Button(button_frame, text="Clear Console", 
                  command=self.clear_console,
                  font=("Helvetica", 12),
                  bg="#e74c3c", fg="white",
                  activebackground="#c0392b",
                  activeforeground="white").pack(side="left", padx=5)

        stats_frame = tk.Frame(self.root, bg="#34495e", padx=10, pady=10)
        stats_frame.pack(fill="x", padx=10, pady=5)

        stats = [
            ("Total Wallets:", "total_wallets"),
            ("Processed:", "processed"),
            ("Successful:", "successful"),
            ("Failed:", "failed"),
            ("ETH Sent:", "eth_sent")
        ]

        for text, var_name in stats:
            frame = tk.Frame(stats_frame, bg="#34495e")
            frame.pack(side="left", expand=True)

            tk.Label(frame, text=text, font=("Helvetica", 10), 
                     fg="white", bg="#34495e").pack()

            setattr(self, var_name, tk.Label(frame, text="0", 
                                             font=("Helvetica", 12, "bold"), 
                                             fg="#f39c12", bg="#34495e"))
            getattr(self, var_name).pack()

    def update_ui_callback(self, message, msg_type="info"):
        self.root.after(0, self.update_console, message, msg_type)

    def update_console(self, message, msg_type="info"):
        color_map = {
            "success": "#2ecc71",
            "error": "#e74c3c",
            "warning": "#f39c12",
            "info": "#3498db"
        }
        self.console.tag_config(msg_type, foreground=color_map.get(msg_type, "#ecf0f1"))
        self.console.insert("end", message + "\n", msg_type)
        self.console.see("end")
        self.root.update()

    def clear_console(self):
        self.console.delete(1.0, "end")

    def start_sending(self):
        self.start_btn.config(state="disabled")
        threading.Thread(target=self.run_sender, daemon=True).start()

    def run_sender(self):
        try:
            self.update_console("\n=== Starting ETH Sending Process ===\n", "info")
            self.sender.run()
        except Exception as e:
            self.update_console(f"\nFatal error: {str(e)}\n", "error")
        finally:
            self.start_btn.config(state="normal")

class MegaEthSender:
    def __init__(self, ui_callback):
        self.ui_callback = ui_callback
        self.rpc_endpoints = ['https://carrot.megaeth.com/rpc']
        self.chain_id = 6342
        self.max_fee_per_gas = Web3.to_wei(0.0025, 'gwei')
        self.max_priority_fee_per_gas = Web3.to_wei(0.001, 'gwei')
        self.w3 = self._connect_to_provider()
        self.target_address = self._load_target_address()
        self.private_keys = self._load_private_keys()
        self.eth_sent = 0.0

    def _connect_to_provider(self):
        for endpoint in self.rpc_endpoints:
            try:
                w3 = Web3(Web3.HTTPProvider(endpoint))
                if w3.is_connected():
                    self.ui_callback(f"✓ Connected to {endpoint}", "success")
                    return w3
            except Exception as e:
                self.ui_callback(f"⚠ Connection failed to {endpoint}: {str(e)}", "warning")
        raise ConnectionError("Could not connect to any RPC endpoint")

    def _load_target_address(self):
        with open('target_address.txt', 'r') as f:
            address = f.read().strip()
        if not Web3.is_address(address):
            raise ValueError("Invalid target address")
        return address

    def _load_private_keys(self):
        keys = []
        with open('private_keys.txt', 'r') as f:
            for line in f:
                line = line.strip()
                if line:
                    keys.append(line)
        if not keys:
            raise ValueError("No private keys found")
        return keys

    def transfer_eth(self, private_key):
        account = self.w3.eth.account.from_key(private_key)
        address = account.address
        try:
            balance_wei = self.w3.eth.get_balance(address)
            balance_eth = float(Web3.from_wei(balance_wei, 'ether'))
            if balance_eth <= 0:
                self.ui_callback(f"{address[:8]}...{address[-6:]} - Zero balance", "warning")
                return None
            gas_cost = float(Web3.from_wei(21000 * self.max_fee_per_gas, 'ether'))
            amount_to_send = max(balance_eth - gas_cost, 0)
            if amount_to_send <= 0:
                self.ui_callback(f"{address[:8]}...{address[-6:]} - Insufficient balance", "warning")
                return None
            tx = {
                'nonce': self.w3.eth.get_transaction_count(address),
                'to': self.target_address,
                'value': Web3.to_wei(amount_to_send, 'ether'),
                'gas': 21000,
                'maxFeePerGas': self.max_fee_per_gas,
                'maxPriorityFeePerGas': self.max_priority_fee_per_gas,
                'chainId': self.chain_id,
                'type': '0x2'
            }
            signed_tx = self.w3.eth.account.sign_transaction(tx, private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            self.eth_sent += amount_to_send
            with open('transactions.csv', 'a', newline='') as f:
                writer = csv.writer(f)
                writer.writerow([address, balance_eth, amount_to_send, tx_hash.hex()])
            self.ui_callback(f"{address[:8]}...{address[-6:]} - Sent {amount_to_send:.6f} ETH", "success")
            return tx_hash.hex()
        except Exception as e:
            with open('errors.log', 'a') as f:
                f.write(f"{address},{str(e)}\n")
            self.ui_callback(f"{address[:8]}...{address[-6:]} - Error: {str(e)}", "error")
            return None

    def run(self):
        start_time = time.time()
        with open('transactions.csv', 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['Address', 'Balance', 'Amount Sent', 'TxHash'])
        with ThreadPoolExecutor(max_workers=5) as executor:
            results = list(executor.map(self.transfer_eth, self.private_keys))
        successful = sum(1 for result in results if result is not None)
        failed = len(self.private_keys) - successful
        elapsed = time.time() - start_time
        self.ui_callback("\n=== Transaction Summary ===", "info")
        self.ui_callback(f"Total Wallets: {len(self.private_keys)}", "info")
        self.ui_callback(f"Successful: {successful}", "success")
        self.ui_callback(f"Failed: {failed}", "error" if failed > 0 else "success")
        self.ui_callback(f"ETH Sent: {self.eth_sent:.6f}", "info")
        self.ui_callback(f"Time: {elapsed:.2f} seconds", "info")

# Entry point
if __name__ == "__main__":
    def run_gui():
        root = tk.Tk()
        app = MegaEthSenderGUI(root)
        root.mainloop()

    def run_cli():
        def cli_callback(msg, msg_type="info"):
            prefix = {
                "success": "[✓]",
                "error": "[✗]",
                "warning": "[!]",
                "info": "[i]"
            }.get(msg_type, "[*]")
            print(f"{prefix} {msg}")
        sender = MegaEthSender(cli_callback)
        print("\n=== MEGA ETH Sender Pro [CLI MODE] ===")
        sender.run()

    if os.environ.get("DISPLAY"):
        run_gui()
    else:
        run_cli()
