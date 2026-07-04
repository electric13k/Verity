# Verity Setup Guide

Verity is a calm, precise, and trustworthy multi-model AI orchestration platform. It allows you to ask questions that are checked against multiple AIs, verified, and merged into one truth.

## Prerequisites
- Node.js 20+
- npm

## Installation

### 1. Clone the Project
```bash
git clone <repository-url>
cd ai-orchestrator
```

### 2. Backend Setup
```bash
cd backend
npm install
# Copy and fill the .env file
cp .env.example .env
# Generate keys if needed (must be 32+ chars)
# openssl rand -hex 32
npm run dev
```

### Troubleshooting better-sqlite3 on Windows
If you encounter errors installing `better-sqlite3`, ensure you have:
1. [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) installed with "Desktop development with C++".
2. Node.js 20+ installed.
3. If errors persist, try: `npm install --build-from-source` inside the backend directory.

### 3. Frontend Setup
```bash
cd ../frontend
npm install
npm run dev
```

## Accessing the App
Open [http://localhost:5173](http://localhost:5173) in your browser.

## Default Credentials (Development)
- Email: `demo@example.com`
- Password: `password123`
*(Note: You can also register a new account locally)*

## Features
- **H.C.T. Reasoning Frameworks**: HAISB, CMA, and TUML implemented in core services.
- **Connector System**: Supports OpenAI, Claude, Ollama, Kimi, and various system tools.
- **Security**: AES-256-GCM encryption for API keys and Argon2 for password hashing.
- **Local-First**: Built-in SQLite database and support for local Ollama models.
- **Responsive UI**: Modern dashboard with dark mode support.
