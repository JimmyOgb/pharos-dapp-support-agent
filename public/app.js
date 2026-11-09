document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('diagnose-form');
  const txInput = document.getElementById('tx-hash-input');
  const networkSelect = document.getElementById('network-select');
  const clearBtn = document.getElementById('clear-btn');
  const submitBtn = document.getElementById('submit-btn');
  const btnText = document.getElementById('btn-text');

  const loadingState = document.getElementById('loading-state');
  const loadingTitle = document.getElementById('loading-step-title');
  const loadingDesc = document.getElementById('loading-step-desc');

  const errorState = document.getElementById('error-state');
  const errorTitle = document.getElementById('error-title');
  const errorMessage = document.getElementById('error-message');
  const retryBtn = document.getElementById('retry-btn');

  const resultSection = document.getElementById('result-section');
  const verdictCard = document.getElementById('verdict-card');
  const verdictStatus = document.getElementById('verdict-status-badge');
  const verdictCategory = document.getElementById('verdict-category-badge');
  const verdictConfidence = document.getElementById('verdict-confidence-badge');
  const verdictSummary = document.getElementById('verdict-summary');
  const explorerLink = document.getElementById('explorer-link');

  const plainExplanation = document.getElementById('plain-explanation');
  const resolutionSteps = document.getElementById('resolution-steps');
  const preventativeSteps = document.getElementById('preventative-steps');
  const uncertaintyBox = document.getElementById('uncertainty-box');
  const uncertaintyNotes = document.getElementById('uncertainty-notes');

  const forensicHash = document.getElementById('forensic-hash');
  const forensicNetwork = document.getElementById('forensic-network');
  const forensicBlock = document.getElementById('forensic-block');
  const forensicFrom = document.getElementById('forensic-from');
  const forensicTo = document.getElementById('forensic-to');
  const forensicValue = document.getElementById('forensic-value');
  const forensicGas = document.getElementById('forensic-gas');
  const gasProgressBar = document.getElementById('gas-progress-bar');
  const forensicMethod = document.getElementById('forensic-method');

  const evidenceTypeBadge = document.getElementById('evidence-type-badge');
  const technicalReason = document.getElementById('technical-reason');
  const decodedSignature = document.getElementById('decoded-signature');
  const rawRevertBytes = document.getElementById('raw-revert-bytes');

  // Input clear button toggle
  txInput.addEventListener('input', () => {
    clearBtn.style.display = txInput.value.length > 0 ? 'block' : 'none';
  });

  clearBtn.addEventListener('click', () => {
    txInput.value = '';
    clearBtn.style.display = 'none';
    txInput.focus();
  });

  // Preset pill clicks
  document.querySelectorAll('.preset-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const hash = pill.getAttribute('data-hash');
      const network = pill.getAttribute('data-network') || 'pacific';
      txInput.value = hash;
      clearBtn.style.display = 'block';
      networkSelect.value = network;
      runDiagnosis(hash, network);
    });
  });

  // Form submit
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const hash = txInput.value.trim();
    const network = networkSelect.value;

    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      alert('Please enter a valid 32-byte Ethereum transaction hash (0x followed by 64 hex characters).');
      txInput.focus();
      return;
    }

    runDiagnosis(hash, network);
  });

  retryBtn.addEventListener('click', () => {
    const hash = txInput.value.trim();
    const network = networkSelect.value;
    if (hash) {
      runDiagnosis(hash, network);
    }
  });

  async function runDiagnosis(hash, network) {
    // Reset view
    errorState.classList.add('hidden');
    resultSection.classList.add('hidden');
    loadingState.classList.remove('hidden');
    submitBtn.disabled = true;
    btnText.textContent = 'Diagnosing...';

    // Step progression animation
    const steps = [
      { title: 'Connecting to Chain MCP...', desc: 'Initializing JSON-RPC session on mcp.pharos.xyz' },
      { title: 'Retrieving On-Chain Data...', desc: 'Executing get_transaction and get_transaction_receipt' },
      { title: 'Running Execution Forensics...', desc: 'Replaying eth_call at block height to extract revert bytes' },
      { title: 'Decoding Failure Evidence...', desc: 'Synthesizing deterministic failure category and plain-English plan' },
    ];

    let stepIdx = 0;
    const interval = setInterval(() => {
      stepIdx++;
      if (stepIdx < steps.length) {
        loadingTitle.textContent = steps[stepIdx].title;
        loadingDesc.textContent = steps[stepIdx].desc;
      }
    }, 450);

    try {
      const resp = await fetch('/api/diagnose', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ hash, network }),
      });

      clearInterval(interval);

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${resp.status} from diagnostic engine`);
      }

      const data = await resp.json();
      renderDiagnosis(data);
    } catch (err) {
      clearInterval(interval);
      console.error('Diagnostic error:', err);
      loadingState.classList.add('hidden');
      errorState.classList.remove('hidden');
      errorTitle.textContent = 'Diagnosis Failed';
      errorMessage.textContent = err.message || 'Unable to connect to Chain MCP or diagnose transaction.';
    } finally {
      submitBtn.disabled = false;
      btnText.textContent = 'Diagnose Transaction';
    }
  }

  function renderDiagnosis(data) {
    loadingState.classList.add('hidden');
    resultSection.classList.remove('hidden');

    const isSuccess = data.status === 'SUCCESS';
    verdictCard.className = isSuccess ? 'card verdict-card success-card' : 'card verdict-card';

    // Status Badge
    verdictStatus.textContent = data.status;
    verdictStatus.className = isSuccess ? 'badge-status success' : 'badge-status failed';

    // Category & Confidence
    verdictCategory.textContent = data.categoryLabel || data.category;
    verdictConfidence.textContent = `CONFIDENCE: ${data.confidence || 'HIGH'}`;

    // Summary & Explorer link
    verdictSummary.textContent = data.resolution.summary;
    explorerLink.href = data.explorerUrl;
    explorerLink.textContent = `View on ${data.network.name.includes('Pacific') ? 'PharosScan (Pacific)' : 'PharosScan (Atlantic)'} ↗`;

    // Plain English explanation
    plainExplanation.textContent = data.resolution.plainEnglishExplanation;

    // Actionable steps
    resolutionSteps.innerHTML = '';
    data.resolution.actionableSteps.forEach((step) => {
      const li = document.createElement('li');
      li.textContent = step;
      resolutionSteps.appendChild(li);
    });

    // Preventative steps
    preventativeSteps.innerHTML = '';
    if (data.resolution.preventativeAdvice && data.resolution.preventativeAdvice.length > 0) {
      document.getElementById('preventative-box').classList.remove('hidden');
      data.resolution.preventativeAdvice.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        preventativeSteps.appendChild(li);
      });
    } else {
      document.getElementById('preventative-box').classList.add('hidden');
    }

    // Uncertainty notes
    if (data.resolution.uncertaintyNotes && data.resolution.uncertaintyNotes.length > 0) {
      uncertaintyBox.classList.remove('hidden');
      uncertaintyNotes.innerHTML = '';
      data.resolution.uncertaintyNotes.forEach((note) => {
        const li = document.createElement('li');
        li.textContent = note;
        uncertaintyNotes.appendChild(li);
      });
    } else {
      uncertaintyBox.classList.add('hidden');
    }

    // Forensic Grid
    const ev = data.evidence;
    const gas = data.gas;

    forensicHash.textContent = ev.transactionHash;
    forensicNetwork.textContent = `${data.network.name} (Chain ID ${data.network.chainId})`;
    forensicBlock.textContent = ev.blockNumber ? `#${ev.blockNumber.toLocaleString()}` : 'N/A';
    if (ev.timestamp) {
      forensicBlock.textContent += ` (${new Date(ev.timestamp).toLocaleTimeString()})`;
    }

    forensicFrom.textContent = ev.from || 'N/A';
    forensicTo.textContent = ev.to ? `${ev.to}${ev.recipientIsContract ? ' [Contract]' : ' [EOA]'}` : 'Contract Creation';
    forensicValue.textContent = `${ev.valueNative} ${data.network.currency} (${ev.valueWei} wei)`;

    // Gas bar
    const gasPct = gas.gasLimit > 0 ? (gas.gasUsed / gas.gasLimit) * 100 : 0;
    forensicGas.textContent = `${gas.gasUsed.toLocaleString()} / ${gas.gasLimit.toLocaleString()} (${gasPct.toFixed(1)}%) — Fee: ${gas.totalFeeNative} ${data.network.currency}`;
    gasProgressBar.style.width = `${Math.min(100, Math.max(3, gasPct))}%`;
    gasProgressBar.className = gas.isOutOfGas ? 'progress-bar-fill oog' : 'progress-bar-fill';

    forensicMethod.textContent = ev.decodedMethodName ? `${ev.decodedMethodName} [${ev.methodSelector}]` : ev.methodSelector;

    // EVM Evidence
    technicalReason.textContent = data.resolution.technicalReason;
    evidenceTypeBadge.textContent = data.decodedError ? data.decodedError.type : 'No Revert Data';

    if (data.decodedError) {
      decodedSignature.textContent = data.decodedError.signature || data.decodedError.selector || 'N/A';
      rawRevertBytes.textContent = data.decodedError.rawBytes || '0x';
    } else {
      decodedSignature.textContent = 'None returned by EVM node (status 0)';
      rawRevertBytes.textContent = '0x';
    }

    // Smooth scroll into view
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Copy to clipboard helper
  document.querySelectorAll('.copyable').forEach((el) => {
    el.addEventListener('click', () => {
      const text = el.textContent.split(' ')[0];
      if (text && text !== 'N/A') {
        navigator.clipboard.writeText(text);
        const original = el.textContent;
        el.textContent = 'Copied to clipboard!';
        setTimeout(() => {
          el.textContent = original;
        }, 1500);
      }
    });
  });
});
