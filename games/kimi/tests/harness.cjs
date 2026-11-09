"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function makeElement(id) {
  const classes = new Set(id === "menuScreen" ? [] : ["hidden"]);
  const listeners = new Map();
  return {
    id,
    style: {},
    textContent: "",
    innerHTML: "",
    children: [],
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        if (force === undefined) {
          if (classes.has(name)) classes.delete(name); else classes.add(name);
        } else if (force) classes.add(name); else classes.delete(name);
      }
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    appendChild(child) { this.children.push(child); return child; },
    click() { if (listeners.has("click")) listeners.get("click")(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
    setPointerCapture() {},
    get offsetWidth() { return 100; }
  };
}

function loadGame() {
  const elements = new Map();
  const timers = new Map();
  let nextTimerId = 1;
  const gradient = { addColorStop() {} };
  const context2d = new Proxy({
    createRadialGradient: () => gradient,
    measureText: (text) => ({ width: String(text).length * 10 })
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const element = makeElement(id);
        if (id === "gameCanvas") element.getContext = () => context2d;
        elements.set(id, element);
      }
      return elements.get(id);
    },
    createElement() { return makeElement("dynamic"); }
  };
  const sandbox = {
    console,
    document,
    performance: { now: () => 0 },
    requestAnimationFrame() {},
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout(callback) { const id = nextTimerId++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    Math,
    JSON
  };
  sandbox.window = sandbox;
  sandbox.window.matchMedia = () => ({ matches: false });
  sandbox.window.addEventListener = () => {};
  vm.createContext(sandbox);
  const filename = path.join(__dirname, "..", "game.js");
  vm.runInContext(fs.readFileSync(filename, "utf8"), sandbox, { filename });
  const flushTimers = () => {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach((callback) => callback());
  };
  return { game: sandbox.window.neonHarbor, elements, sandbox, flushTimers };
}

function freshGame() {
  const harness = loadGame();
  harness.game.start();
  harness.game.announce = () => {};
  return harness;
}

module.exports = { loadGame, freshGame };
