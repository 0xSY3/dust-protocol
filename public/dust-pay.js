/*
 * Dust pay button. Drop into any page:
 *   <script src="https://<dust-app>/dust-pay.js" defer></script>
 *   <button data-dust-pay data-merchant="alice" data-amount="12.50" data-memo="Order 1042"></button>
 *
 * Optional attributes: data-invoice (0x + 32 hex, else a random reference is generated per click),
 * data-due (YYYY-MM-DD), data-chain / data-token (default: USDT on Whitechain Sepolia), data-slug.
 * Fires `dust:open` when checkout opens and `dust:paid` { invoiceId, txHash, chainId } when the
 * customer pays. Treat `dust:paid` as a UX signal; settle orders from the Dust merchant view,
 * which verifies the transfer on-chain.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;
  var DUST_ORIGIN = new URL(script.src).origin;
  var DEFAULT_CHAIN = '1874';
  var DEFAULT_TOKEN = '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7';
  var PAID_MESSAGE = 'dust:invoice-paid';
  // 0x-prefixed 16-byte invoice reference
  var INVOICE_ID = /^0x[0-9a-f]{32}$/;
  // 0x-prefixed 32-byte transaction hash
  var TX_HASH = /^0x[0-9a-fA-F]{64}$/;

  function randomInvoiceId() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return '0x' + Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function openCheckout(button) {
    var data = button.dataset;
    if (!data.merchant || !data.amount) {
      console.error('[dust-pay] data-merchant and data-amount are required', button);
      return;
    }
    var requested = (data.invoice || '').toLowerCase();
    var invoiceId = INVOICE_ID.test(requested) ? requested : randomInvoiceId();
    var params = new URLSearchParams({
      inv: invoiceId,
      chain: data.chain || DEFAULT_CHAIN,
      token: data.token || DEFAULT_TOKEN,
      amount: data.amount,
      origin: window.location.origin,
    });
    if (data.memo) params.set('memo', data.memo);
    if (data.due) params.set('due', data.due);

    var url = DUST_ORIGIN + '/pay/' + encodeURIComponent(data.merchant) + '/' +
      encodeURIComponent(data.slug || 'checkout') + '?' + params.toString();
    button.setAttribute('data-dust-pending', invoiceId);
    window.open(url, 'dust-pay', 'popup,width=480,height=780');
    button.dispatchEvent(new CustomEvent('dust:open', { bubbles: true, detail: { invoiceId: invoiceId } }));
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (event.origin !== DUST_ORIGIN || !message || message.type !== PAID_MESSAGE) return;
    if (!INVOICE_ID.test(message.invoiceId) || !TX_HASH.test(message.txHash)) return;
    var button = document.querySelector('[data-dust-pay][data-dust-pending="' + message.invoiceId + '"]');
    if (!button) return;
    button.disabled = true;
    button.textContent = 'Paid';
    button.dispatchEvent(new CustomEvent('dust:paid', {
      bubbles: true,
      detail: { invoiceId: message.invoiceId, txHash: message.txHash, chainId: message.chainId },
    }));
  });

  document.querySelectorAll('[data-dust-pay]').forEach(function (button) {
    if (!button.textContent.trim()) button.textContent = 'Pay ' + button.dataset.amount + ' USDT privately';
    button.addEventListener('click', function () { openCheckout(button); });
  });
})();
