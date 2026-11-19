(() => {
  "use strict";

  const STORAGE_KEY = "robo_blackjack_chf_v1";
  const STARTING_BALANCE = 1000;
  const TOPUP_AMOUNT = 1000;
  const DECK_COUNT = 6;

  const SUITS = [
    { symbol: "♠", color: "black" },
    { symbol: "♥", color: "red" },
    { symbol: "♦", color: "red" },
    { symbol: "♣", color: "black" },
  ];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

  // --- State ---
  let state = {
    balance: STARTING_BALANCE,
    currentBet: 0,
    betChips: [],
    lastBet: 0,
    shoe: [],
    dealerHand: [],
    dealerRevealed: false,
    playerHands: [], // [{ cards: [], bet: number, doubled: boolean, stood: boolean, isBlackjack: boolean, outcome: null|'win'|'lose'|'push', payout: number }]
    activeHandIndex: 0,
    phase: "betting", // "betting" | "playing" | "dealer" | "settled"
    soundEnabled: true,
    stats: {
      rounds: 0,
      wins: 0,
      blackjacks: 0,
      peak: STARTING_BALANCE,
    },
  };

  // --- DOM Elements ---
  const el = {
    balanceDisplay: document.getElementById("balance-display"),
    topupBtn: document.getElementById("topup-btn"),
    soundToggle: document.getElementById("sound-toggle"),
    robotAvatar: document.getElementById("robot-avatar"),
    robotSpeech: document.getElementById("robot-speech"),
    dealerScore: document.getElementById("dealer-score"),
    dealerCards: document.getElementById("dealer-cards"),
    resultBanner: document.getElementById("result-banner"),
    resultTitle: document.getElementById("result-title"),
    resultSubtitle: document.getElementById("result-subtitle"),
    betCircle: document.getElementById("bet-circle"),
    betCirclePlaceholder: document.getElementById("bet-circle-placeholder"),
    tableChipStack: document.getElementById("table-chip-stack"),
    betInput: document.getElementById("bet-input"),
    playerHands: document.getElementById("player-hands"),
    bettingControls: document.getElementById("betting-controls"),
    playingControls: document.getElementById("playing-controls"),
    nextControls: document.getElementById("next-controls"),
    chips: document.querySelectorAll(".chip"),
    clearBetBtn: document.getElementById("clear-bet-btn"),
    rebetBtn: document.getElementById("rebet-btn"),
    allinBtn: document.getElementById("allin-btn"),
    dealBtn: document.getElementById("deal-btn"),
    hitBtn: document.getElementById("hit-btn"),
    standBtn: document.getElementById("stand-btn"),
    doubleBtn: document.getElementById("double-btn"),
    splitBtn: document.getElementById("split-btn"),
    newRoundBtn: document.getElementById("new-round-btn"),
    quickRebetBtn: document.getElementById("quick-rebet-btn"),
  };

  // --- Audio (Web Audio API) ---
  let audioCtx = null;
  function playTone(freq, duration, type = "sine", volume = 0.08) {
    if (!state.soundEnabled) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(volume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch {
      // Ignore audio errors on restricted browsers
    }
  }

  function soundChip() { playTone(720, 0.06, "triangle", 0.07); }
  function soundCard() { playTone(320, 0.08, "sine", 0.05); }
  function soundWin() {
    playTone(523.25, 0.12, "triangle", 0.08);
    setTimeout(() => playTone(659.25, 0.14, "triangle", 0.08), 90);
    setTimeout(() => playTone(783.99, 0.22, "triangle", 0.09), 180);
  }
  function soundLose() {
    playTone(260, 0.16, "sawtooth", 0.05);
    setTimeout(() => playTone(196, 0.24, "sawtooth", 0.05), 140);
  }

  // --- Helpers ---
  function formatCHF(amount) {
    const fixed = Number(amount).toFixed(2);
    const [intPart, decPart] = fixed.split(".");
    const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    return `CHF ${withSep}.${decPart}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function saveProgress() {
    try {
      const payload = {
        balance: state.balance + (state.phase === "betting" ? state.currentBet : 0),
        lastBet: state.lastBet,
        soundEnabled: state.soundEnabled,
        stats: state.stats,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage errors
    }
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.balance === "number" && parsed.balance >= 0) {
        state.balance = parsed.balance;
      }
      if (typeof parsed.lastBet === "number" && parsed.lastBet >= 0) {
        state.lastBet = parsed.lastBet;
      }
      if (typeof parsed.soundEnabled === "boolean") {
        state.soundEnabled = parsed.soundEnabled;
      }
      if (parsed.stats && typeof parsed.stats === "object") {
        state.stats = { ...state.stats, ...parsed.stats };
      }
    } catch {
      // Ignore corrupt storage
    }
  }

  // --- Deck & Hand Evaluation ---
  function createShoe() {
    const shoe = [];
    for (let d = 0; d < DECK_COUNT; d++) {
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          shoe.push({ rank, suit: suit.symbol, color: suit.color });
        }
      }
    }
    for (let i = shoe.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }
    return shoe;
  }

  function drawCard() {
    if (state.shoe.length < 52) {
      state.shoe = createShoe();
      setRobotSpeech("Neuer 6-Deck-Schuh wurde frisch gemischt.");
    }
    soundCard();
    return state.shoe.pop();
  }

  function cardBaseValue(rank) {
    if (rank === "A") return 11;
    if (["K", "Q", "J"].includes(rank)) return 10;
    return parseInt(rank, 10);
  }

  function evaluateHand(cards) {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
      if (c.rank === "A") {
        aces += 1;
        total += 11;
      } else {
        total += cardBaseValue(c.rank);
      }
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    const isSoft = aces > 0 && total <= 21;
    const isBust = total > 21;
    const isBlackjack = cards.length === 2 && total === 21;
    return { total, isSoft, isBust, isBlackjack };
  }

  function setRobotSpeech(text, thinking = false) {
    el.robotSpeech.textContent = text;
    el.robotAvatar.classList.toggle("thinking", thinking);
  }

  // --- Rendering ---
  function createCardElement(card, faceDown = false) {
    const div = document.createElement("div");
    if (faceDown) {
      div.className = "card card-back";
      div.setAttribute("aria-label", "Verdeckte Karte");
      return div;
    }
    div.className = `card ${card.color}`;
    div.innerHTML = `
      <div class="card-corner">
        <span class="card-rank">${card.rank}</span>
        <span class="card-suit-sm">${card.suit}</span>
      </div>
      <div class="card-center">${card.suit}</div>
      <div class="card-corner bottom">
        <span class="card-rank">${card.rank}</span>
        <span class="card-suit-sm">${card.suit}</span>
      </div>
    `;
    return div;
  }

  function decomposeToChips(amount) {
    const denoms = [500, 100, 50, 25, 10, 5, 1];
    let remaining = Math.floor(amount);
    const chips = [];
    for (const d of denoms) {
      while (remaining >= d && chips.length < 18) {
        chips.push(d);
        remaining -= d;
      }
    }
    return chips;
  }

  function render() {
    el.balanceDisplay.textContent = formatCHF(state.balance);
    el.soundToggle.textContent = state.soundEnabled ? "🔊" : "🔇";

    // Total bet displayed & center poker chip stack
    const totalActiveBet =
      state.phase === "betting"
        ? state.currentBet
        : state.playerHands.reduce((sum, h) => sum + h.bet, 0);

    if (document.activeElement !== el.betInput) {
      el.betInput.value = totalActiveBet;
    }
    el.betInput.disabled = state.phase !== "betting";

    const chipsToShow =
      state.phase === "betting" ? state.betChips : decomposeToChips(totalActiveBet);
    el.tableChipStack.innerHTML = "";
    el.betCirclePlaceholder.classList.toggle("hidden", chipsToShow.length > 0 || totalActiveBet > 0);
    chipsToShow.slice(-12).forEach((val, idx) => {
      const chipEl = document.createElement("div");
      chipEl.className = `table-chip chip-${val}`;
      chipEl.style.transform = `translateY(${-idx * 4}px)`;
      chipEl.textContent = val;
      el.tableChipStack.appendChild(chipEl);
    });

    // Dealer cards & score
    el.dealerCards.innerHTML = "";
    state.dealerHand.forEach((card, idx) => {
      const hidden = idx === 1 && !state.dealerRevealed;
      el.dealerCards.appendChild(createCardElement(card, hidden));
    });

    el.dealerScore.className = "score-pill";
    if (state.dealerHand.length === 0) {
      el.dealerScore.textContent = "0";
    } else if (!state.dealerRevealed) {
      const firstVal = cardBaseValue(state.dealerHand[0].rank);
      el.dealerScore.textContent = `${firstVal} + ?`;
    } else {
      const evalD = evaluateHand(state.dealerHand);
      el.dealerScore.textContent = evalD.isBlackjack ? "BLACKJACK!" : `${evalD.total}`;
      if (evalD.isBust) el.dealerScore.classList.add("bust");
      if (evalD.isBlackjack) el.dealerScore.classList.add("blackjack");
    }

    // Player hands
    el.playerHands.innerHTML = "";
    if (state.playerHands.length === 0) {
      const placeholder = document.createElement("div");
      placeholder.className = "hand-box";
      placeholder.innerHTML = `
        <div class="hand-meta">
          <span class="zone-title">DEINE HAND</span>
          <span class="score-pill">0</span>
        </div>
        <div class="cards-row"></div>
      `;
      el.playerHands.appendChild(placeholder);
    } else {
      state.playerHands.forEach((hand, idx) => {
        const evalH = evaluateHand(hand.cards);
        const box = document.createElement("div");
        const isActive = state.phase === "playing" && idx === state.activeHandIndex;
        box.className = `hand-box${isActive ? " active-hand" : ""}`;

        const label = state.playerHands.length > 1 ? `HAND ${idx + 1}` : "DEINE HAND";
        const scoreText = hand.isBlackjack
          ? "BLACKJACK!"
          : evalH.isBust
          ? `${evalH.total} (Bust)`
          : `${evalH.total}`;

        let outcomeHtml = "";
        if (hand.outcome) {
          const outcomeLabels = {
            win: `Gewinn +${formatCHF(hand.payout - hand.bet)}`,
            lose: "Verloren",
            push: "Unentschieden",
          };
          outcomeHtml = `<span class="hand-outcome ${hand.outcome}">${outcomeLabels[hand.outcome]}</span>`;
        }

        const pillClass = `score-pill${evalH.isBust ? " bust" : ""}${hand.isBlackjack ? " blackjack" : ""}`;

        box.innerHTML = `
          <div class="hand-meta">
            <span class="zone-title">${label}</span>
            <span class="${pillClass}">${scoreText}</span>
            <span class="hand-bet">${formatCHF(hand.bet)}</span>
            ${outcomeHtml}
          </div>
          <div class="cards-row"></div>
        `;
        const cardsRow = box.querySelector(".cards-row");
        hand.cards.forEach((c) => cardsRow.appendChild(createCardElement(c, false)));
        el.playerHands.appendChild(box);
      });
    }

    // Controls visibility
    el.bettingControls.classList.toggle("hidden", state.phase !== "betting");
    el.playingControls.classList.toggle("hidden", state.phase !== "playing");
    el.nextControls.classList.toggle("hidden", state.phase !== "settled");

    if (state.phase === "betting") {
      el.chips.forEach((chip) => {
        const val = Number(chip.dataset.value);
        chip.disabled = state.balance < val;
      });
      el.clearBetBtn.disabled = state.currentBet === 0;
      el.dealBtn.disabled = state.currentBet <= 0;
      el.rebetBtn.disabled = state.lastBet <= 0 || state.balance + state.currentBet < state.lastBet;
      el.allinBtn.disabled = state.balance <= 0;
    }

    if (state.phase === "playing") {
      const hand = state.playerHands[state.activeHandIndex];
      const canDouble = hand && hand.cards.length === 2 && state.balance >= hand.bet;
      const canSplit =
        state.playerHands.length === 1 &&
        hand &&
        hand.cards.length === 2 &&
        cardBaseValue(hand.cards[0].rank) === cardBaseValue(hand.cards[1].rank) &&
        state.balance >= hand.bet;

      el.doubleBtn.disabled = !canDouble;
      el.splitBtn.disabled = !canSplit;
    }

    if (state.phase === "settled") {
      el.quickRebetBtn.disabled = state.lastBet <= 0 || state.balance < state.lastBet;
    }
  }

  // --- Betting Actions ---
  function addBet(amount) {
    if (state.phase !== "betting") return;
    if (state.balance < amount) return;
    soundChip();
    state.balance -= amount;
    state.currentBet += amount;
    state.betChips.push(amount);
    render();
  }

  function removeTopChip() {
    if (state.phase !== "betting" || state.betChips.length === 0) return;
    const removed = state.betChips.pop();
    state.balance += removed;
    state.currentBet = Math.max(0, state.currentBet - removed);
    soundChip();
    render();
  }

  function setBetFromInput(rawValue) {
    if (state.phase !== "betting") return;
    const available = state.balance + state.currentBet;
    let parsed = Math.floor(Number(rawValue));
    if (!Number.isFinite(parsed) || parsed < 0) parsed = 0;
    if (parsed > available) parsed = Math.floor(available);
    state.balance = available - parsed;
    state.currentBet = parsed;
    state.betChips = decomposeToChips(parsed);
    render();
  }

  function clearBet() {
    if (state.phase !== "betting" || state.currentBet === 0) return;
    state.balance += state.currentBet;
    state.currentBet = 0;
    state.betChips = [];
    render();
  }

  function applyRebet() {
    if (state.phase !== "betting") return;
    const available = state.balance + state.currentBet;
    if (state.lastBet <= 0 || available < state.lastBet) return;
    state.balance = available - state.lastBet;
    state.currentBet = state.lastBet;
    state.betChips = decomposeToChips(state.lastBet);
    soundChip();
    render();
  }

  function allIn() {
    if (state.phase !== "betting" || state.balance <= 0) return;
    soundChip();
    state.currentBet += state.balance;
    state.balance = 0;
    state.betChips = decomposeToChips(state.currentBet);
    render();
  }

  // --- Game Flow ---
  async function startDeal() {
    if (state.phase !== "betting" || state.currentBet <= 0) return;

    state.lastBet = state.currentBet;
    state.phase = "playing";
    state.dealerRevealed = false;
    state.dealerHand = [];
    state.playerHands = [
      {
        cards: [],
        bet: state.currentBet,
        doubled: false,
        stood: false,
        isBlackjack: false,
        outcome: null,
        payout: 0,
      },
    ];
    state.currentBet = 0;
    state.betChips = [];
    state.activeHandIndex = 0;
    el.resultBanner.classList.add("hidden");
    setRobotSpeech("Karten werden ausgeteilt…", true);
    render();

    await sleep(180);
    state.playerHands[0].cards.push(drawCard());
    render();
    await sleep(200);
    state.dealerHand.push(drawCard());
    render();
    await sleep(200);
    state.playerHands[0].cards.push(drawCard());
    render();
    await sleep(200);
    state.dealerHand.push(drawCard());
    render();

    const playerEval = evaluateHand(state.playerHands[0].cards);
    const dealerEval = evaluateHand(state.dealerHand);

    if (playerEval.isBlackjack) {
      state.playerHands[0].isBlackjack = true;
    }

    // Check immediate Blackjack
    if (playerEval.isBlackjack || dealerEval.isBlackjack) {
      state.dealerRevealed = true;
      await sleep(300);
      settleRound();
      return;
    }

    setRobotSpeech("Du bist am Zug! Karte, Halten, Verdoppeln oder Teilen?", false);
    render();
  }

  async function playerHit() {
    if (state.phase !== "playing") return;
    const hand = state.playerHands[state.activeHandIndex];
    hand.cards.push(drawCard());
    const evalH = evaluateHand(hand.cards);
    render();

    if (evalH.isBust || evalH.total === 21) {
      hand.stood = true;
      await sleep(280);
      await advanceHandOrDealer();
    }
  }

  async function playerStand() {
    if (state.phase !== "playing") return;
    state.playerHands[state.activeHandIndex].stood = true;
    await advanceHandOrDealer();
  }

  async function playerDouble() {
    if (state.phase !== "playing") return;
    const hand = state.playerHands[state.activeHandIndex];
    if (hand.cards.length !== 2 || state.balance < hand.bet) return;

    soundChip();
    state.balance -= hand.bet;
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(drawCard());
    hand.stood = true;
    render();

    await sleep(350);
    await advanceHandOrDealer();
  }

  async function playerSplit() {
    if (state.phase !== "playing" || state.playerHands.length !== 1) return;
    const orig = state.playerHands[0];
    if (
      orig.cards.length !== 2 ||
      cardBaseValue(orig.cards[0].rank) !== cardBaseValue(orig.cards[1].rank) ||
      state.balance < orig.bet
    ) {
      return;
    }

    soundChip();
    state.balance -= orig.bet;

    const hand1 = {
      cards: [orig.cards[0], drawCard()],
      bet: orig.bet,
      doubled: false,
      stood: false,
      isBlackjack: false,
      outcome: null,
      payout: 0,
    };
    const hand2 = {
      cards: [orig.cards[1], drawCard()],
      bet: orig.bet,
      doubled: false,
      stood: false,
      isBlackjack: false,
      outcome: null,
      payout: 0,
    };

    state.playerHands = [hand1, hand2];
    state.activeHandIndex = 0;
    setRobotSpeech("Hand geteilt! Spiele zuerst Hand 1.", false);
    render();
  }

  async function advanceHandOrDealer() {
    if (state.activeHandIndex + 1 < state.playerHands.length) {
      state.activeHandIndex += 1;
      setRobotSpeech(`Jetzt ist Hand ${state.activeHandIndex + 1} am Zug.`, false);
      render();
      return;
    }

    // All player hands finished
    const allBust = state.playerHands.every((h) => evaluateHand(h.cards).isBust);
    state.phase = "dealer";
    state.dealerRevealed = true;
    setRobotSpeech("Decke meine zweite Karte auf…", true);
    render();

    if (!allBust) {
      await sleep(500);
      while (evaluateHand(state.dealerHand).total < 17) {
        setRobotSpeech("Ich muss ziehen (< 17)…", true);
        state.dealerHand.push(drawCard());
        render();
        await sleep(520);
      }
    }

    settleRound();
  }

  function settleRound() {
    state.phase = "settled";
    const dealerEval = evaluateHand(state.dealerHand);

    let totalWagered = 0;
    let totalReturned = 0;
    let roundWins = 0;
    let roundBlackjacks = 0;

    state.playerHands.forEach((hand) => {
      totalWagered += hand.bet;
      const playerEval = evaluateHand(hand.cards);

      if (playerEval.isBust) {
        hand.outcome = "lose";
        hand.payout = 0;
      } else if (hand.isBlackjack && !dealerEval.isBlackjack) {
        hand.outcome = "win";
        hand.payout = hand.bet * 2.5; // 3:2 payout
        roundWins += 1;
        roundBlackjacks += 1;
      } else if (dealerEval.isBlackjack && !hand.isBlackjack) {
        hand.outcome = "lose";
        hand.payout = 0;
      } else if (hand.isBlackjack && dealerEval.isBlackjack) {
        hand.outcome = "push";
        hand.payout = hand.bet;
      } else if (dealerEval.isBust || playerEval.total > dealerEval.total) {
        hand.outcome = "win";
        hand.payout = hand.bet * 2;
        roundWins += 1;
      } else if (playerEval.total === dealerEval.total) {
        hand.outcome = "push";
        hand.payout = hand.bet;
      } else {
        hand.outcome = "lose";
        hand.payout = 0;
      }

      totalReturned += hand.payout;
    });

    state.balance += totalReturned;
    state.stats.rounds += 1;
    state.stats.wins += roundWins;
    state.stats.blackjacks += roundBlackjacks;
    if (state.balance > state.stats.peak) {
      state.stats.peak = state.balance;
    }

    const net = totalReturned - totalWagered;
    el.resultBanner.classList.remove("hidden", "win", "lose", "push");

    if (net > 0) {
      el.resultBanner.classList.add("win");
      el.resultTitle.textContent = roundBlackjacks > 0 ? "BLACKJACK! GEWONNEN!" : "GEWONNEN!";
      el.resultSubtitle.textContent = `+${formatCHF(net)} Reingewinn`;
      setRobotSpeech("Stark gespielt! Dein CHF-Konto wächst.", false);
      soundWin();
    } else if (net === 0) {
      el.resultBanner.classList.add("push");
      el.resultTitle.textContent = "UNENTSCHIEDEN (PUSH)";
      el.resultSubtitle.textContent = "Dein Einsatz wurde zurückerstattet.";
      setRobotSpeech("Gleichstand – niemand verliert etwas.", false);
    } else {
      el.resultBanner.classList.add("lose");
      el.resultTitle.textContent = dealerEval.isBlackjack ? "ROBO-BLACKJACK!" : "DER ROBOTER GEWINNT";
      el.resultSubtitle.textContent = `${formatCHF(net)} in dieser Runde`;
      setRobotSpeech(
        state.balance === 0
          ? "Konto leer! Klicke oben auf «+ CHF 1'000 gratis»."
          : "Diesmal geht die Runde an mich. Noch eine?",
        false
      );
      soundLose();
    }

    saveProgress();
    render();
  }

  function resetToBetting(autoRebet = false) {
    state.phase = "betting";
    state.dealerHand = [];
    state.dealerRevealed = false;
    state.playerHands = [];
    state.activeHandIndex = 0;
    state.betChips = [];
    el.resultBanner.classList.add("hidden");

    if (autoRebet && state.lastBet > 0 && state.balance >= state.lastBet) {
      state.balance -= state.lastBet;
      state.currentBet = state.lastBet;
      state.betChips = decomposeToChips(state.lastBet);
      render();
      startDeal();
      return;
    }

    setRobotSpeech("Setze deine CHF-Jetons für die nächste Runde.", false);
    render();
  }

  function topUpFreeCHF() {
    state.balance += TOPUP_AMOUNT;
    if (state.balance > state.stats.peak) {
      state.stats.peak = state.balance;
    }
    soundWin();
    setRobotSpeech(`+${formatCHF(TOPUP_AMOUNT)} gratis gutgeschrieben! Viel Glück.`, false);
    saveProgress();
    render();
  }

  function resetAll() {
    state.balance = STARTING_BALANCE;
    state.currentBet = 0;
    state.betChips = [];
    state.lastBet = 0;
    state.phase = "betting";
    state.dealerHand = [];
    state.dealerRevealed = false;
    state.playerHands = [];
    state.stats = {
      rounds: 0,
      wins: 0,
      blackjacks: 0,
      peak: STARTING_BALANCE,
    };
    el.resultBanner.classList.add("hidden");
    setRobotSpeech("Konto auf CHF 1'000.00 zurückgesetzt. Bereit!", false);
    saveProgress();
    render();
  }

  // --- Event Listeners ---
  el.chips.forEach((chip) => {
    chip.addEventListener("click", () => addBet(Number(chip.dataset.value)));
  });

  el.betCircle.addEventListener("click", removeTopChip);
  el.betInput.addEventListener("input", (e) => setBetFromInput(e.target.value));
  el.betInput.addEventListener("blur", () => {
    el.betInput.value = state.phase === "betting" ? state.currentBet : el.betInput.value;
  });

  el.clearBetBtn.addEventListener("click", clearBet);
  el.rebetBtn.addEventListener("click", applyRebet);
  el.allinBtn.addEventListener("click", allIn);
  el.dealBtn.addEventListener("click", startDeal);

  el.hitBtn.addEventListener("click", playerHit);
  el.standBtn.addEventListener("click", playerStand);
  el.doubleBtn.addEventListener("click", playerDouble);
  el.splitBtn.addEventListener("click", playerSplit);

  el.newRoundBtn.addEventListener("click", () => resetToBetting(false));
  el.quickRebetBtn.addEventListener("click", () => resetToBetting(true));

  el.topupBtn.addEventListener("click", topUpFreeCHF);

  el.soundToggle.addEventListener("click", () => {
    state.soundEnabled = !state.soundEnabled;
    saveProgress();
    render();
  });

  // --- Init ---
  loadProgress();
  state.shoe = createShoe();
  render();
})();
