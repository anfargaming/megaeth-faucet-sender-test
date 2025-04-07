.dashboard {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family: Arial, sans-serif;
}

header {
  text-align: center;
  margin-bottom: 30px;
}

header h1 {
  color: #2c3e50;
}

.connection-status {
  padding: 5px 10px;
  border-radius: 4px;
  display: inline-block;
}

.connection-status.connected {
  background-color: #d4edda;
  color: #155724;
}

.configuration {
  background-color: #f8f9fa;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.input-group {
  margin-bottom: 15px;
}

.input-group label {
  display: block;
  margin-bottom: 5px;
  font-weight: bold;
}

.input-group input[type="text"],
.input-group textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid #ced4da;
  border-radius: 4px;
  box-sizing: border-box;
}

.file-upload {
  display: inline-block;
  background-color: #e9ecef;
  padding: 5px 10px;
  border-radius: 4px;
  cursor: pointer;
  margin-top: 5px;
}

.file-upload:hover {
  background-color: #dee2e6;
}

.gas-settings {
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid #dee2e6;
}

.gas-settings h3 {
  margin-top: 0;
}

.gas-settings div {
  margin-bottom: 10px;
}

.gas-settings label {
  display: inline-block;
  width: 200px;
}

.actions {
  text-align: center;
  margin: 20px 0;
}

button {
  background-color: #007bff;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
}

button:hover {
  background-color: #0069d9;
}

button:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}

.status {
  margin: 20px 0;
  padding: 15px;
  background-color: #f8f9fa;
  border-radius: 8px;
}

.progress {
  margin-bottom: 10px;
}

.progress progress {
  width: 100%;
  height: 20px;
}

.error {
  color: #721c24;
  background-color: #f8d7da;
  border: 1px solid #f5c6cb;
  padding: 10px;
  border-radius: 4px;
}

.transactions {
  margin-top: 30px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #ddd;
}

th {
  background-color: #f2f2f2;
}

.status-pending {
  color: #856404;
  background-color: #fff3cd;
}

.status-confirmed {
  color: #155724;
  background-color: #d4edda;
}
