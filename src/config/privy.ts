// Privy social login configuration
// App ID is configured in the Privy dashboard at https://console.privy.io

import type { PrivyClientConfig } from '@privy-io/react-auth';

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

/** Whether Privy social login is available (feature flag) */
export const isPrivyEnabled = !!PRIVY_APP_ID;

export const PRIVY_CONFIG: PrivyClientConfig = {
  loginMethods: ['google', 'email', 'farcaster', 'wallet'],
  appearance: {
    theme: 'dark',
    accentColor: '#7c7fff', // matches PrivateWallet indigo accent
    landingHeader: 'Sign in to Dust Protocol',
    loginMessage: 'Private payments powered by stealth addresses',
    showWalletLoginFirst: false,
    walletList: ['metamask', 'detected_wallets', 'wallet_connect'],
  },
  embeddedWallets: {
    ethereum: {
      createOnLogin: 'users-without-wallets',
    },
  },
};
