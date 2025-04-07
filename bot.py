import os
import time
import csv
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
from concurrent.futures import ThreadPoolExecutor
from web3 import Web3
from web3.exceptions import TransactionNotFound
from dotenv import load_dotenv
import threading
from PIL import Image, ImageTk
import random

# Load environment variables
load_dotenv()

class AnimatedGradientLabel(tk.Canvas):
    def __init__(self, master, text, font, colors, width, height, speed=0.5):
        super().__init__(master, width=width, height=height, highlightthickness=0)
        self.text = text
        self.font = font
        self.colors = colors
        self.speed = speed
        self.width = width
        self.height = height
        self.offset = 0
        self.create_animation()
        
    def create_animation(self):
        self.delete("all")
        for i in range(0, self.width, 5):
            color = self.get_gradient_color(i + self.offset)
            self.create_line(i, 0, i, self.height, fill=color, width=5)
        self.create_text(self.width//2, self.height//2, text=self.text, 
                        font=self.font, fill="white")
        self.offset += self.speed
        if self.offset > 100:
            self.offset = 0
        self.after(50, self.create_animation)
        
    def get_gradient_color(self, position):
        position = position % 100
        if position < 33:
            r = int(self.colors[0][0] * (33 - position) / 33 + self.colors[1][0] * position / 33)
            g = int(self.colors[0][1] * (33 - position) / 33 + self.colors[1][1] * position / 33)
            b = int(self.colors[0][2] * (33 - position) / 33 + self.colors[1][2] * position / 33)
        elif position < 66:
            position -= 33
            r = int(self.colors[1][0] * (33 - position) / 33 + self.colors[2][0] * position / 33)
            g = int(self.colors[1][1] * (33 - position) / 33 + self.colors[2][1] * position / 33)
            b = int(self.colors[1][2] * (33 - position) / 33 + self.colors[2][2] * position / 33)
        else:
            position -= 66
            r = int(self.colors[2][0] * (33 - position) / 33 + self.colors[0][0] * position / 33)
            g = int(self.colors[2][1] * (33 - position) / 33 + self.colors[0][1] * position / 33)
            b = int(self.colors[2][2] * (33 - position) / 33 + self.colors[0][2] * position / 33)
        return f"#{r:02x}{g:02x}{b:02x}"

class MegaEthSenderGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("MEGA ETH Sender Pro")
        self.root.geometry("1000x800")
        self.root.configure(bg="#1a1a2e")
        self.root.minsize(900, 700)
        
        # Setup modern theme
        self.setup_theme()
        
        # Initialize sender
        self.sender = MegaEthSender(self.update_ui_callback)
        
        # Setup UI
        self.setup_ui()
        
        # Animation variables
        self.active_animation = None
        self.pulsing_widgets = []
        
    def setup_theme(self):
        style = ttk.Style()
        style.theme_use('clam')
        
        # Configure colors
        style.configure('TFrame', background='#1a1a2e')
        style.configure('TLabel', background='#1a1a2e', foreground='white')
        style.configure('TButton', font=('Helvetica', 10), padding=5)
        style.configure('TProgressbar', thickness=15, troughcolor='#16213e', 
                       background='#0f3460', lightcolor='#00b4d8', darkcolor='#00b4d8')
        
    def setup_ui(self):
        # Main container
        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # Header with animated gradient
        header_frame = ttk.Frame(main_frame)
        header_frame.pack(fill=tk.X, pady=(0, 10))
        
        gradient_colors = [
            (41, 128, 185),  # Blue
            (142, 68, 173),   # Purple
            (39, 174, 96)     # Green
        ]
        self.header = AnimatedGradientLabel(
            header_frame, 
            text="MEGA ETH Sender Pro", 
            font=("Helvetica", 24, "bold"),
            colors=gradient_colors,
            width=980,
            height=80
        )
        self.header.pack()
        
        # Network info frame
        info_frame = ttk.Frame(main_frame, style='TFrame')
        info_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(info_frame, text="Target Address:", font=('Helvetica', 10)).pack(side=tk.LEFT, padx=5)
        self.target_label = ttk.Label(info_frame, text=self.sender.target_address[:12] + "..." + self.sender.target_address[-6:], 
                                    font=('Helvetica', 10, 'bold'), foreground='#00b4d8')
        self.target_label.pack(side=tk.LEFT)
        
        ttk.Label(info_frame, text="Network:", font=('Helvetica', 10)).pack(side=tk.LEFT, padx=10)
        self.network_label = ttk.Label(info_frame, text="MEGA Testnet (Chain ID: 6342)", 
                                     font=('Helvetica', 10, 'bold'), foreground='#2ecc71')
        self.network_label.pack(side=tk.LEFT)
        
        # Progress frame
        progress_frame = ttk.Frame(main_frame)
        progress_frame.pack(fill=tk.X, pady=10)
        
        self.progress = ttk.Progressbar(progress_frame, orient=tk.HORIZONTAL, length=400, mode='determinate')
        self.progress.pack(side=tk.LEFT, expand=True, fill=tk.X)
        
        self.status_label = ttk.Label(progress_frame, text="Ready", font=('Helvetica', 10), foreground='white')
        self.status_label.pack(side=tk.LEFT, padx=10)
        
        # Console output with modern styling
        console_frame = ttk.Frame(main_frame)
        console_frame.pack(fill=tk.BOTH, expand=True)
        
        self.console = scrolledtext.ScrolledText(
            console_frame,
            wrap=tk.WORD,
            font=('Consolas', 10),
            bg='#16213e',
            fg='#e6e6e6',
            insertbackground='white',
            selectbackground='#0f3460',
            selectforeground='white',
            padx=10,
            pady=10
        )
        self.console.pack(fill=tk.BOTH, expand=True)
        
        # Stats frame with cards
        stats_frame = ttk.Frame(main_frame)
        stats_frame.pack(fill=tk.X, pady=10)
        
        stats = [
            ("Total Wallets", "total_wallets", "#3498db"),
            ("Processed", "processed", "#9b59b6"),
            ("Successful", "successful", "#2ecc71"),
            ("Failed", "failed", "#e74c3c"),
            ("ETH Sent", "eth_sent", "#f39c12")
        ]
        
        for text, var_name, color in stats:
            card = ttk.Frame(stats_frame, style='TFrame')
            card.pack(side=tk.LEFT, expand=True, padx=5)
            
            # Card header
            card_header = ttk.Frame(card, style='TFrame')
            card_header.pack(fill=tk.X)
            
            ttk.Label(card_header, text=text, font=('Helvetica', 10), 
                     foreground='white', background=color).pack(fill=tk.X, ipady=2)
            
            # Card value
            setattr(self, var_name, ttk.Label(card, text="0", font=('Helvetica', 14, 'bold'), 
                                            foreground=color))
            getattr(self, var_name).pack(pady=5)
            
            # Add pulsing animation to cards
            self.pulsing_widgets.append(getattr(self, var_name))
        
        # Action buttons
        button_frame = ttk.Frame(main_frame)
        button_frame.pack(fill=tk.X, pady=10)
        
        self.start_btn = ttk.Button(
            button_frame,
            text="Start Sending",
            command=self.start_sending,
            style='TButton'
        )
        self.start_btn.pack(side=tk.LEFT, padx=5, ipadx=20)
        
        clear_btn = ttk.Button(
            button_frame,
            text="Clear Console",
            command=self.clear_console,
            style='TButton'
        )
        clear_btn.pack(side=tk.LEFT, padx=5, ipadx=20)
        
        # Start pulsing animation
        self.pulse_animation()
    
    def pulse_animation(self):
        for widget in self.pulsing_widgets:
            current_fg = widget.cget('foreground')
            r, g, b = widget.winfo_rgb(current_fg)
            r = min(65535, int(r * 1.1))
            g = min(65535, int(g * 1.1))
            b = min(65535, int(b * 1.1))
            widget.config(foreground=f'#{r//256:02x}{g//256:02x}{b//256:02x}')
        
        self.root.after(500, self.reverse_pulse)
    
    def reverse_pulse(self):
        for widget in self.pulsing_widgets:
            current_fg = widget.cget('foreground')
            r, g, b = widget.winfo_rgb(current_fg)
            r = max(0, int(r / 1.1))
            g = max(0, int(g / 1.1))
            b = max(0, int(b / 1.1))
            widget.config(foreground=f'#{r//256:02x}{g//256:02x}{b//256:02x}')
        
        self.root.after(500, self.pulse_animation)
    
    def update_ui_callback(self, message, msg_type="info"):
        self.root.after(0, self.update_console, message, msg_type)
        
    def update_console(self, message, msg_type="info"):
        color_map = {
            "success": "#2ecc71",
            "error": "#e74c3c",
            "warning": "#f39c12",
            "info": "#3498db",
            "system": "#9b59b6"
        }
        
        tag_name = f"tag_{msg_type}"
        self.console.tag_config(tag_name, foreground=color_map.get(msg_type, "#e6e6e6"))
        
        # Add timestamp
        timestamp = time.strftime("%H:%M:%S")
        self.console.insert(tk.END, f"[{timestamp}] ", "system")
        self.console.insert(tk.END, message + "\n", tag_name)
        
        # Auto-scroll
        self.console.see(tk.END)
        self.root.update()
    
    def clear_console(self):
        self.console.delete(1.0, tk.END)
    
    def start_sending(self):
        self.start_btn.config(state=tk.DISABLED)
        self.status_label.config(text="Processing...", foreground='#00b4d8')
        
        # Start processing in background thread
        threading.Thread(target=self.run_sender, daemon=True).start()
    
    def run_sender(self):
        try:
            self.update_console("=== Starting ETH Sending Process ===", "info")
            
            # Initialize CSV
            with open('transactions.csv', 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['Address', 'Balance', 'Amount Sent', 'TxHash'])
            
            # Process wallets
            with ThreadPoolExecutor(max_workers=5) as executor:
                results = list(executor.map(self.sender.transfer_eth, self.sender.private_keys))
            
            # Update stats
            successful = sum(1 for result in results if result is not None)
            failed = len(self.sender.private_keys) - successful
            
            # Final report
            self.update_console("\n=== Transaction Summary ===", "info")
            self.update_console(f"Total Wallets: {len(self.sender.private_keys)}", "info")
            self.update_console(f"Successful: {successful}", "success")
            self.update_console(f"Failed: {failed}", "error" if failed > 0 else "success")
            
            # Show completion message
            self.status_label.config(text="Completed", foreground='#2ecc71')
            messagebox.showinfo("Completed", f"Processing complete!\nSuccessful: {successful}\nFailed: {failed}")
            
        except Exception as e:
            self.update_console(f"Fatal error: {str(e)}", "error")
            self.status_label.config(text="Error", foreground='#e74c3c')
            messagebox.showerror("Error", f"An error occurred:\n{str(e)}")
        finally:
            self.start_btn.config(state=tk.NORMAL)

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

    def _connect_to_provider(self):
        for endpoint in self.rpc_endpoints:
            try:
                w3 = Web3(Web3.HTTPProvider(endpoint))
                if w3.is_connected():
                    self.ui_callback(f"Connected to {endpoint}", "success")
                    return w3
            except Exception as e:
                self.ui_callback(f"Connection failed to {endpoint}: {str(e)}", "warning")
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
            # Get balance
            balance_wei = self.w3.eth.get_balance(address)
            balance_eth = float(Web3.from_wei(balance_wei, 'ether'))
            
            if balance_eth <= 0:
                self.ui_callback(f"{address[:8]}...{address[-6:]} - Zero balance", "warning")
                return None
            
            # Calculate transfer amount
            gas_cost = float(Web3.from_wei(21000 * self.max_fee_per_gas, 'ether'))
            amount_to_send = max(balance_eth - gas_cost, 0)
            
            if amount_to_send <= 0:
                self.ui_callback(f"{address[:8]}...{address[-6:]} - Insufficient balance (needs {gas_cost:.6f} ETH for gas)", "warning")
                return None
            
            # Prepare transaction
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
            
            # Send transaction
            signed_tx = self.w3.eth.account.sign_transaction(tx, private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            # Log transaction
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

if __name__ == "__main__":
    root = tk.Tk()
    app = MegaEthSenderGUI(root)
    root.mainloop()
