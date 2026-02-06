# Stealth Address Relayer Service

A privacy-preserving relayer that submits transactions on behalf of users, hiding their identity on-chain.

## How It Works

1. User receives funds at a stealth address
2. User sends the stealth private key to the relayer
3. Relayer submits the withdrawal transaction
4. User's main wallet never appears on-chain

## Quick Start (Local)

```bash
# From the project root
RELAYER_PRIVATE_KEY=<your_private_key> npm run relayer:start
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RELAYER_PRIVATE_KEY` | Yes | - | Private key for the relayer wallet |
| `RELAYER_PORT` or `PORT` | No | 3001 | Port to listen on |
| `RPC_URL` | No | Thanos Sepolia | RPC endpoint |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origins (comma-separated) |
| `FEE_BPS` | No | 50 | Fee in basis points (50 = 0.5%) |
| `MIN_FEE` | No | 0.001 | Minimum fee in ETH |
| `NODE_ENV` | No | development | Set to `production` for prod mode |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/info` | Relayer info (address, balance, fees) |
| POST | `/calculate-fee` | Calculate fee for a withdrawal |
| POST | `/withdraw` | Submit a withdrawal request |
| GET | `/status/:jobId` | Check job status |

## Deployment Options

### Option 1: Railway (Easiest)

1. Fork/clone this repo to GitHub
2. Go to [railway.app](https://railway.app)
3. Create new project → Deploy from GitHub
4. Select the repo
5. Add environment variable: `RELAYER_PRIVATE_KEY`
6. Railway will auto-detect the Dockerfile and deploy

Your relayer URL will be: `https://<project>.up.railway.app`

### Option 2: Render

1. Go to [render.com](https://render.com)
2. New → Web Service → Connect your repo
3. Set:
   - Build Command: `npm install express cors ethers@5`
   - Start Command: `node relayer/index.js`
4. Add environment variable: `RELAYER_PRIVATE_KEY`

### Option 3: Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch (from relayer directory)
cd relayer
fly launch

# Set secrets
fly secrets set RELAYER_PRIVATE_KEY=<your_key>

# Deploy
fly deploy
```

### Option 4: Docker (Any Cloud)

```bash
# Build
docker build -t stealth-relayer -f relayer/Dockerfile .

# Run
docker run -d \
  -p 3001:3001 \
  -e RELAYER_PRIVATE_KEY=<your_key> \
  stealth-relayer
```

### Option 5: VPS (DigitalOcean, AWS, etc.)

```bash
# SSH into your server
ssh user@your-server

# Clone repo
git clone https://github.com/your/repo.git
cd repo

# Install dependencies
npm install

# Run with PM2 (process manager)
npm install -g pm2
RELAYER_PRIVATE_KEY=<key> pm2 start relayer/index.js --name stealth-relayer

# Save PM2 config
pm2 save
pm2 startup
```

## After Deployment

1. Get your relayer URL (e.g., `https://stealth-relayer.up.railway.app`)

2. Update your frontend `.env`:
   ```
   NEXT_PUBLIC_RELAYER_URL=https://stealth-relayer.up.railway.app
   ```

3. Redeploy your frontend

4. **Fund the relayer wallet** - the relayer needs ETH to pay for gas initially
   (it will earn fees from withdrawals)

## Security Considerations

⚠️ **Trust Model**: Users send their stealth private keys to the relayer. This requires trusting the relayer operator.

- The relayer could theoretically steal funds (but has no incentive - it earns fees legitimately)
- For maximum security, users should run their own relayer
- In production, consider adding:
  - HTTPS (most platforms provide this)
  - API authentication
  - Redis for distributed rate limiting
  - Logging to external service

## Contract Address

The StealthRelayer contract is deployed at:
- **Thanos Sepolia**: `0x77c3d8c2B0bb27c9A8ACCa39F2398aaa021eb776`

## Fees

- Default: 0.5% of withdrawal amount
- Minimum: 0.001 ETH
- Configurable via environment variables
