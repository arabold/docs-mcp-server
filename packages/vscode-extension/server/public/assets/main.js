function src_default$1(e) {
  e.directive("collapse", t), t.inline = (n, { modifiers: i }) => {
    i.includes("min") && (n._x_doShow = () => {
    }, n._x_doHide = () => {
    });
  };
  function t(n, { modifiers: i }) {
    let r = modifierValue$1(i, "duration", 250) / 1e3, a = modifierValue$1(i, "min", 0), s = !i.includes("min");
    n._x_isShown || (n.style.height = `${a}px`), !n._x_isShown && s && (n.hidden = !0), n._x_isShown || (n.style.overflow = "hidden");
    let o = (c, u) => {
      let d = e.setStyles(c, u);
      return u.height ? () => {
      } : d;
    }, l = {
      transitionProperty: "height",
      transitionDuration: `${r}s`,
      transitionTimingFunction: "cubic-bezier(0.4, 0.0, 0.2, 1)"
    };
    n._x_transition = {
      in(c = () => {
      }, u = () => {
      }) {
        s && (n.hidden = !1), s && (n.style.display = null);
        let d = n.getBoundingClientRect().height;
        n.style.height = "auto";
        let h = n.getBoundingClientRect().height;
        d === h && (d = a), e.transition(n, e.setStyles, {
          during: l,
          start: { height: d + "px" },
          end: { height: h + "px" }
        }, () => n._x_isShown = !0, () => {
          Math.abs(n.getBoundingClientRect().height - h) < 1 && (n.style.overflow = null);
        });
      },
      out(c = () => {
      }, u = () => {
      }) {
        let d = n.getBoundingClientRect().height;
        e.transition(n, o, {
          during: l,
          start: { height: d + "px" },
          end: { height: a + "px" }
        }, () => n.style.overflow = "hidden", () => {
          n._x_isShown = !1, n.style.height == `${a}px` && s && (n.style.display = "none", n.hidden = !0);
        });
      }
    };
  }
}
function modifierValue$1(e, t, n) {
  if (e.indexOf(t) === -1)
    return n;
  const i = e[e.indexOf(t) + 1];
  if (!i)
    return n;
  if (t === "duration") {
    let r = i.match(/([0-9]+)ms/);
    if (r)
      return r[1];
  }
  if (t === "min") {
    let r = i.match(/([0-9]+)px/);
    if (r)
      return r[1];
  }
  return i;
}
var module_default$1 = src_default$1, flushPending = !1, flushing = !1, queue = [], lastFlushedIndex = -1;
function scheduler(e) {
  queueJob(e);
}
function queueJob(e) {
  queue.includes(e) || queue.push(e), queueFlush();
}
function dequeueJob(e) {
  let t = queue.indexOf(e);
  t !== -1 && t > lastFlushedIndex && queue.splice(t, 1);
}
function queueFlush() {
  !flushing && !flushPending && (flushPending = !0, queueMicrotask(flushJobs));
}
function flushJobs() {
  flushPending = !1, flushing = !0;
  for (let e = 0; e < queue.length; e++)
    queue[e](), lastFlushedIndex = e;
  queue.length = 0, lastFlushedIndex = -1, flushing = !1;
}
var reactive, effect$3, release, raw, shouldSchedule = !0;
function disableEffectScheduling(e) {
  shouldSchedule = !1, e(), shouldSchedule = !0;
}
function setReactivityEngine(e) {
  reactive = e.reactive, release = e.release, effect$3 = (t) => e.effect(t, { scheduler: (n) => {
    shouldSchedule ? scheduler(n) : n();
  } }), raw = e.raw;
}
function overrideEffect(e) {
  effect$3 = e;
}
function elementBoundEffect(e) {
  let t = () => {
  };
  return [(i) => {
    let r = effect$3(i);
    return e._x_effects || (e._x_effects = /* @__PURE__ */ new Set(), e._x_runEffects = () => {
      e._x_effects.forEach((a) => a());
    }), e._x_effects.add(r), t = () => {
      r !== void 0 && (e._x_effects.delete(r), release(r));
    }, r;
  }, () => {
    t();
  }];
}
function watch(e, t) {
  let n = !0, i, r = effect$3(() => {
    let a = e();
    JSON.stringify(a), n ? i = a : queueMicrotask(() => {
      t(a, i), i = a;
    }), n = !1;
  });
  return () => release(r);
}
var onAttributeAddeds = [], onElRemoveds = [], onElAddeds = [];
function onElAdded(e) {
  onElAddeds.push(e);
}
function onElRemoved(e, t) {
  typeof t == "function" ? (e._x_cleanups || (e._x_cleanups = []), e._x_cleanups.push(t)) : (t = e, onElRemoveds.push(t));
}
function onAttributesAdded(e) {
  onAttributeAddeds.push(e);
}
function onAttributeRemoved(e, t, n) {
  e._x_attributeCleanups || (e._x_attributeCleanups = {}), e._x_attributeCleanups[t] || (e._x_attributeCleanups[t] = []), e._x_attributeCleanups[t].push(n);
}
function cleanupAttributes(e, t) {
  e._x_attributeCleanups && Object.entries(e._x_attributeCleanups).forEach(([n, i]) => {
    (t === void 0 || t.includes(n)) && (i.forEach((r) => r()), delete e._x_attributeCleanups[n]);
  });
}
function cleanupElement(e) {
  for (e._x_effects?.forEach(dequeueJob); e._x_cleanups?.length; )
    e._x_cleanups.pop()();
}
var observer = new MutationObserver(onMutate), currentlyObserving = !1;
function startObservingMutations() {
  observer.observe(document, { subtree: !0, childList: !0, attributes: !0, attributeOldValue: !0 }), currentlyObserving = !0;
}
function stopObservingMutations() {
  flushObserver(), observer.disconnect(), currentlyObserving = !1;
}
var queuedMutations = [];
function flushObserver() {
  let e = observer.takeRecords();
  queuedMutations.push(() => e.length > 0 && onMutate(e));
  let t = queuedMutations.length;
  queueMicrotask(() => {
    if (queuedMutations.length === t)
      for (; queuedMutations.length > 0; )
        queuedMutations.shift()();
  });
}
function mutateDom(e) {
  if (!currentlyObserving)
    return e();
  stopObservingMutations();
  let t = e();
  return startObservingMutations(), t;
}
var isCollecting = !1, deferredMutations = [];
function deferMutations() {
  isCollecting = !0;
}
function flushAndStopDeferringMutations() {
  isCollecting = !1, onMutate(deferredMutations), deferredMutations = [];
}
function onMutate(e) {
  if (isCollecting) {
    deferredMutations = deferredMutations.concat(e);
    return;
  }
  let t = [], n = /* @__PURE__ */ new Set(), i = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map();
  for (let a = 0; a < e.length; a++)
    if (!e[a].target._x_ignoreMutationObserver && (e[a].type === "childList" && (e[a].removedNodes.forEach((s) => {
      s.nodeType === 1 && s._x_marker && n.add(s);
    }), e[a].addedNodes.forEach((s) => {
      if (s.nodeType === 1) {
        if (n.has(s)) {
          n.delete(s);
          return;
        }
        s._x_marker || t.push(s);
      }
    })), e[a].type === "attributes")) {
      let s = e[a].target, o = e[a].attributeName, l = e[a].oldValue, c = () => {
        i.has(s) || i.set(s, []), i.get(s).push({ name: o, value: s.getAttribute(o) });
      }, u = () => {
        r.has(s) || r.set(s, []), r.get(s).push(o);
      };
      s.hasAttribute(o) && l === null ? c() : s.hasAttribute(o) ? (u(), c()) : u();
    }
  r.forEach((a, s) => {
    cleanupAttributes(s, a);
  }), i.forEach((a, s) => {
    onAttributeAddeds.forEach((o) => o(s, a));
  });
  for (let a of n)
    t.some((s) => s.contains(a)) || onElRemoveds.forEach((s) => s(a));
  for (let a of t)
    a.isConnected && onElAddeds.forEach((s) => s(a));
  t = null, n = null, i = null, r = null;
}
function scope(e) {
  return mergeProxies(closestDataStack(e));
}
function addScopeToNode(e, t, n) {
  return e._x_dataStack = [t, ...closestDataStack(n || e)], () => {
    e._x_dataStack = e._x_dataStack.filter((i) => i !== t);
  };
}
function closestDataStack(e) {
  return e._x_dataStack ? e._x_dataStack : typeof ShadowRoot == "function" && e instanceof ShadowRoot ? closestDataStack(e.host) : e.parentNode ? closestDataStack(e.parentNode) : [];
}
function mergeProxies(e) {
  return new Proxy({ objects: e }, mergeProxyTrap);
}
var mergeProxyTrap = {
  ownKeys({ objects: e }) {
    return Array.from(
      new Set(e.flatMap((t) => Object.keys(t)))
    );
  },
  has({ objects: e }, t) {
    return t == Symbol.unscopables ? !1 : e.some(
      (n) => Object.prototype.hasOwnProperty.call(n, t) || Reflect.has(n, t)
    );
  },
  get({ objects: e }, t, n) {
    return t == "toJSON" ? collapseProxies : Reflect.get(
      e.find(
        (i) => Reflect.has(i, t)
      ) || {},
      t,
      n
    );
  },
  set({ objects: e }, t, n, i) {
    const r = e.find(
      (s) => Object.prototype.hasOwnProperty.call(s, t)
    ) || e[e.length - 1], a = Object.getOwnPropertyDescriptor(r, t);
    return a?.set && a?.get ? a.set.call(i, n) || !0 : Reflect.set(r, t, n);
  }
};
function collapseProxies() {
  return Reflect.ownKeys(this).reduce((t, n) => (t[n] = Reflect.get(this, n), t), {});
}
function initInterceptors(e) {
  let t = (i) => typeof i == "object" && !Array.isArray(i) && i !== null, n = (i, r = "") => {
    Object.entries(Object.getOwnPropertyDescriptors(i)).forEach(([a, { value: s, enumerable: o }]) => {
      if (o === !1 || s === void 0 || typeof s == "object" && s !== null && s.__v_skip)
        return;
      let l = r === "" ? a : `${r}.${a}`;
      typeof s == "object" && s !== null && s._x_interceptor ? i[a] = s.initialize(e, l, a) : t(s) && s !== i && !(s instanceof Element) && n(s, l);
    });
  };
  return n(e);
}
function interceptor(e, t = () => {
}) {
  let n = {
    initialValue: void 0,
    _x_interceptor: !0,
    initialize(i, r, a) {
      return e(this.initialValue, () => get(i, r), (s) => set(i, r, s), r, a);
    }
  };
  return t(n), (i) => {
    if (typeof i == "object" && i !== null && i._x_interceptor) {
      let r = n.initialize.bind(n);
      n.initialize = (a, s, o) => {
        let l = i.initialize(a, s, o);
        return n.initialValue = l, r(a, s, o);
      };
    } else
      n.initialValue = i;
    return n;
  };
}
function get(e, t) {
  return t.split(".").reduce((n, i) => n[i], e);
}
function set(e, t, n) {
  if (typeof t == "string" && (t = t.split(".")), t.length === 1)
    e[t[0]] = n;
  else {
    if (t.length === 0)
      throw error;
    return e[t[0]] || (e[t[0]] = {}), set(e[t[0]], t.slice(1), n);
  }
}
var magics = {};
function magic(e, t) {
  magics[e] = t;
}
function injectMagics(e, t) {
  let n = getUtilities(t);
  return Object.entries(magics).forEach(([i, r]) => {
    Object.defineProperty(e, `$${i}`, {
      get() {
        return r(t, n);
      },
      enumerable: !1
    });
  }), e;
}
function getUtilities(e) {
  let [t, n] = getElementBoundUtilities(e), i = { interceptor, ...t };
  return onElRemoved(e, n), i;
}
function tryCatch(e, t, n, ...i) {
  try {
    return n(...i);
  } catch (r) {
    handleError(r, e, t);
  }
}
function handleError(...e) {
  return errorHandler(...e);
}
var errorHandler = normalErrorHandler;
function setErrorHandler(e) {
  errorHandler = e;
}
function normalErrorHandler(e, t, n = void 0) {
  e = Object.assign(
    e ?? { message: "No error message given." },
    { el: t, expression: n }
  ), console.warn(`Alpine Expression Error: ${e.message}

${n ? 'Expression: "' + n + `"

` : ""}`, t), setTimeout(() => {
    throw e;
  }, 0);
}
var shouldAutoEvaluateFunctions = !0;
function dontAutoEvaluateFunctions(e) {
  let t = shouldAutoEvaluateFunctions;
  shouldAutoEvaluateFunctions = !1;
  let n = e();
  return shouldAutoEvaluateFunctions = t, n;
}
function evaluate(e, t, n = {}) {
  let i;
  return evaluateLater(e, t)((r) => i = r, n), i;
}
function evaluateLater(...e) {
  return theEvaluatorFunction(...e);
}
var theEvaluatorFunction = normalEvaluator;
function setEvaluator(e) {
  theEvaluatorFunction = e;
}
function normalEvaluator(e, t) {
  let n = {};
  injectMagics(n, e);
  let i = [n, ...closestDataStack(e)], r = typeof t == "function" ? generateEvaluatorFromFunction(i, t) : generateEvaluatorFromString(i, t, e);
  return tryCatch.bind(null, e, t, r);
}
function generateEvaluatorFromFunction(e, t) {
  return (n = () => {
  }, { scope: i = {}, params: r = [], context: a } = {}) => {
    let s = t.apply(mergeProxies([i, ...e]), r);
    runIfTypeOfFunction(n, s);
  };
}
var evaluatorMemo = {};
function generateFunctionFromString(e, t) {
  if (evaluatorMemo[e])
    return evaluatorMemo[e];
  let n = Object.getPrototypeOf(async function() {
  }).constructor, i = /^[\n\s]*if.*\(.*\)/.test(e.trim()) || /^(let|const)\s/.test(e.trim()) ? `(async()=>{ ${e} })()` : e, a = (() => {
    try {
      let s = new n(
        ["__self", "scope"],
        `with (scope) { __self.result = ${i} }; __self.finished = true; return __self.result;`
      );
      return Object.defineProperty(s, "name", {
        value: `[Alpine] ${e}`
      }), s;
    } catch (s) {
      return handleError(s, t, e), Promise.resolve();
    }
  })();
  return evaluatorMemo[e] = a, a;
}
function generateEvaluatorFromString(e, t, n) {
  let i = generateFunctionFromString(t, n);
  return (r = () => {
  }, { scope: a = {}, params: s = [], context: o } = {}) => {
    i.result = void 0, i.finished = !1;
    let l = mergeProxies([a, ...e]);
    if (typeof i == "function") {
      let c = i.call(o, i, l).catch((u) => handleError(u, n, t));
      i.finished ? (runIfTypeOfFunction(r, i.result, l, s, n), i.result = void 0) : c.then((u) => {
        runIfTypeOfFunction(r, u, l, s, n);
      }).catch((u) => handleError(u, n, t)).finally(() => i.result = void 0);
    }
  };
}
function runIfTypeOfFunction(e, t, n, i, r) {
  if (shouldAutoEvaluateFunctions && typeof t == "function") {
    let a = t.apply(n, i);
    a instanceof Promise ? a.then((s) => runIfTypeOfFunction(e, s, n, i)).catch((s) => handleError(s, r, t)) : e(a);
  } else typeof t == "object" && t instanceof Promise ? t.then((a) => e(a)) : e(t);
}
var prefixAsString = "x-";
function prefix(e = "") {
  return prefixAsString + e;
}
function setPrefix(e) {
  prefixAsString = e;
}
var directiveHandlers = {};
function directive(e, t) {
  return directiveHandlers[e] = t, {
    before(n) {
      if (!directiveHandlers[n]) {
        console.warn(String.raw`Cannot find directive \`${n}\`. \`${e}\` will use the default order of execution`);
        return;
      }
      const i = directiveOrder.indexOf(n);
      directiveOrder.splice(i >= 0 ? i : directiveOrder.indexOf("DEFAULT"), 0, e);
    }
  };
}
function directiveExists(e) {
  return Object.keys(directiveHandlers).includes(e);
}
function directives(e, t, n) {
  if (t = Array.from(t), e._x_virtualDirectives) {
    let a = Object.entries(e._x_virtualDirectives).map(([o, l]) => ({ name: o, value: l })), s = attributesOnly(a);
    a = a.map((o) => s.find((l) => l.name === o.name) ? {
      name: `x-bind:${o.name}`,
      value: `"${o.value}"`
    } : o), t = t.concat(a);
  }
  let i = {};
  return t.map(toTransformedAttributes((a, s) => i[a] = s)).filter(outNonAlpineAttributes).map(toParsedDirectives(i, n)).sort(byPriority).map((a) => getDirectiveHandler(e, a));
}
function attributesOnly(e) {
  return Array.from(e).map(toTransformedAttributes()).filter((t) => !outNonAlpineAttributes(t));
}
var isDeferringHandlers = !1, directiveHandlerStacks = /* @__PURE__ */ new Map(), currentHandlerStackKey = Symbol();
function deferHandlingDirectives(e) {
  isDeferringHandlers = !0;
  let t = Symbol();
  currentHandlerStackKey = t, directiveHandlerStacks.set(t, []);
  let n = () => {
    for (; directiveHandlerStacks.get(t).length; )
      directiveHandlerStacks.get(t).shift()();
    directiveHandlerStacks.delete(t);
  }, i = () => {
    isDeferringHandlers = !1, n();
  };
  e(n), i();
}
function getElementBoundUtilities(e) {
  let t = [], n = (o) => t.push(o), [i, r] = elementBoundEffect(e);
  return t.push(r), [{
    Alpine: alpine_default,
    effect: i,
    cleanup: n,
    evaluateLater: evaluateLater.bind(evaluateLater, e),
    evaluate: evaluate.bind(evaluate, e)
  }, () => t.forEach((o) => o())];
}
function getDirectiveHandler(e, t) {
  let n = () => {
  }, i = directiveHandlers[t.type] || n, [r, a] = getElementBoundUtilities(e);
  onAttributeRemoved(e, t.original, a);
  let s = () => {
    e._x_ignore || e._x_ignoreSelf || (i.inline && i.inline(e, t, r), i = i.bind(i, e, t, r), isDeferringHandlers ? directiveHandlerStacks.get(currentHandlerStackKey).push(i) : i());
  };
  return s.runCleanups = a, s;
}
var startingWith = (e, t) => ({ name: n, value: i }) => (n.startsWith(e) && (n = n.replace(e, t)), { name: n, value: i }), into = (e) => e;
function toTransformedAttributes(e = () => {
}) {
  return ({ name: t, value: n }) => {
    let { name: i, value: r } = attributeTransformers.reduce((a, s) => s(a), { name: t, value: n });
    return i !== t && e(i, t), { name: i, value: r };
  };
}
var attributeTransformers = [];
function mapAttributes(e) {
  attributeTransformers.push(e);
}
function outNonAlpineAttributes({ name: e }) {
  return alpineAttributeRegex().test(e);
}
var alpineAttributeRegex = () => new RegExp(`^${prefixAsString}([^:^.]+)\\b`);
function toParsedDirectives(e, t) {
  return ({ name: n, value: i }) => {
    let r = n.match(alpineAttributeRegex()), a = n.match(/:([a-zA-Z0-9\-_:]+)/), s = n.match(/\.[^.\]]+(?=[^\]]*$)/g) || [], o = t || e[n] || n;
    return {
      type: r ? r[1] : null,
      value: a ? a[1] : null,
      modifiers: s.map((l) => l.replace(".", "")),
      expression: i,
      original: o
    };
  };
}
var DEFAULT = "DEFAULT", directiveOrder = [
  "ignore",
  "ref",
  "data",
  "id",
  "anchor",
  "bind",
  "init",
  "for",
  "model",
  "modelable",
  "transition",
  "show",
  "if",
  DEFAULT,
  "teleport"
];
function byPriority(e, t) {
  let n = directiveOrder.indexOf(e.type) === -1 ? DEFAULT : e.type, i = directiveOrder.indexOf(t.type) === -1 ? DEFAULT : t.type;
  return directiveOrder.indexOf(n) - directiveOrder.indexOf(i);
}
function dispatch(e, t, n = {}) {
  e.dispatchEvent(
    new CustomEvent(t, {
      detail: n,
      bubbles: !0,
      // Allows events to pass the shadow DOM barrier.
      composed: !0,
      cancelable: !0
    })
  );
}
function walk(e, t) {
  if (typeof ShadowRoot == "function" && e instanceof ShadowRoot) {
    Array.from(e.children).forEach((r) => walk(r, t));
    return;
  }
  let n = !1;
  if (t(e, () => n = !0), n)
    return;
  let i = e.firstElementChild;
  for (; i; )
    walk(i, t), i = i.nextElementSibling;
}
function warn(e, ...t) {
  console.warn(`Alpine Warning: ${e}`, ...t);
}
var started = !1;
function start$1() {
  started && warn("Alpine has already been initialized on this page. Calling Alpine.start() more than once can cause problems."), started = !0, document.body || warn("Unable to initialize. Trying to load Alpine before `<body>` is available. Did you forget to add `defer` in Alpine's `<script>` tag?"), dispatch(document, "alpine:init"), dispatch(document, "alpine:initializing"), startObservingMutations(), onElAdded((t) => initTree(t, walk)), onElRemoved((t) => destroyTree(t)), onAttributesAdded((t, n) => {
    directives(t, n).forEach((i) => i());
  });
  let e = (t) => !closestRoot(t.parentElement, !0);
  Array.from(document.querySelectorAll(allSelectors().join(","))).filter(e).forEach((t) => {
    initTree(t);
  }), dispatch(document, "alpine:initialized"), setTimeout(() => {
    warnAboutMissingPlugins();
  });
}
var rootSelectorCallbacks = [], initSelectorCallbacks = [];
function rootSelectors() {
  return rootSelectorCallbacks.map((e) => e());
}
function allSelectors() {
  return rootSelectorCallbacks.concat(initSelectorCallbacks).map((e) => e());
}
function addRootSelector(e) {
  rootSelectorCallbacks.push(e);
}
function addInitSelector(e) {
  initSelectorCallbacks.push(e);
}
function closestRoot(e, t = !1) {
  return findClosest(e, (n) => {
    if ((t ? allSelectors() : rootSelectors()).some((r) => n.matches(r)))
      return !0;
  });
}
function findClosest(e, t) {
  if (e) {
    if (t(e))
      return e;
    if (e._x_teleportBack && (e = e._x_teleportBack), !!e.parentElement)
      return findClosest(e.parentElement, t);
  }
}
function isRoot(e) {
  return rootSelectors().some((t) => e.matches(t));
}
var initInterceptors2 = [];
function interceptInit(e) {
  initInterceptors2.push(e);
}
var markerDispenser = 1;
function initTree(e, t = walk, n = () => {
}) {
  findClosest(e, (i) => i._x_ignore) || deferHandlingDirectives(() => {
    t(e, (i, r) => {
      i._x_marker || (n(i, r), initInterceptors2.forEach((a) => a(i, r)), directives(i, i.attributes).forEach((a) => a()), i._x_ignore || (i._x_marker = markerDispenser++), i._x_ignore && r());
    });
  });
}
function destroyTree(e, t = walk) {
  t(e, (n) => {
    cleanupElement(n), cleanupAttributes(n), delete n._x_marker;
  });
}
function warnAboutMissingPlugins() {
  [
    ["ui", "dialog", ["[x-dialog], [x-popover]"]],
    ["anchor", "anchor", ["[x-anchor]"]],
    ["sort", "sort", ["[x-sort]"]]
  ].forEach(([t, n, i]) => {
    directiveExists(n) || i.some((r) => {
      if (document.querySelector(r))
        return warn(`found "${r}", but missing ${t} plugin`), !0;
    });
  });
}
var tickStack = [], isHolding = !1;
function nextTick(e = () => {
}) {
  return queueMicrotask(() => {
    isHolding || setTimeout(() => {
      releaseNextTicks();
    });
  }), new Promise((t) => {
    tickStack.push(() => {
      e(), t();
    });
  });
}
function releaseNextTicks() {
  for (isHolding = !1; tickStack.length; )
    tickStack.shift()();
}
function holdNextTicks() {
  isHolding = !0;
}
function setClasses(e, t) {
  return Array.isArray(t) ? setClassesFromString(e, t.join(" ")) : typeof t == "object" && t !== null ? setClassesFromObject(e, t) : typeof t == "function" ? setClasses(e, t()) : setClassesFromString(e, t);
}
function setClassesFromString(e, t) {
  let n = (r) => r.split(" ").filter((a) => !e.classList.contains(a)).filter(Boolean), i = (r) => (e.classList.add(...r), () => {
    e.classList.remove(...r);
  });
  return t = t === !0 ? t = "" : t || "", i(n(t));
}
function setClassesFromObject(e, t) {
  let n = (o) => o.split(" ").filter(Boolean), i = Object.entries(t).flatMap(([o, l]) => l ? n(o) : !1).filter(Boolean), r = Object.entries(t).flatMap(([o, l]) => l ? !1 : n(o)).filter(Boolean), a = [], s = [];
  return r.forEach((o) => {
    e.classList.contains(o) && (e.classList.remove(o), s.push(o));
  }), i.forEach((o) => {
    e.classList.contains(o) || (e.classList.add(o), a.push(o));
  }), () => {
    s.forEach((o) => e.classList.add(o)), a.forEach((o) => e.classList.remove(o));
  };
}
function setStyles(e, t) {
  return typeof t == "object" && t !== null ? setStylesFromObject(e, t) : setStylesFromString(e, t);
}
function setStylesFromObject(e, t) {
  let n = {};
  return Object.entries(t).forEach(([i, r]) => {
    n[i] = e.style[i], i.startsWith("--") || (i = kebabCase(i)), e.style.setProperty(i, r);
  }), setTimeout(() => {
    e.style.length === 0 && e.removeAttribute("style");
  }), () => {
    setStyles(e, n);
  };
}
function setStylesFromString(e, t) {
  let n = e.getAttribute("style", t);
  return e.setAttribute("style", t), () => {
    e.setAttribute("style", n || "");
  };
}
function kebabCase(e) {
  return e.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
function once(e, t = () => {
}) {
  let n = !1;
  return function() {
    n ? t.apply(this, arguments) : (n = !0, e.apply(this, arguments));
  };
}
directive("transition", (e, { value: t, modifiers: n, expression: i }, { evaluate: r }) => {
  typeof i == "function" && (i = r(i)), i !== !1 && (!i || typeof i == "boolean" ? registerTransitionsFromHelper(e, n, t) : registerTransitionsFromClassString(e, i, t));
});
function registerTransitionsFromClassString(e, t, n) {
  registerTransitionObject(e, setClasses, ""), {
    enter: (r) => {
      e._x_transition.enter.during = r;
    },
    "enter-start": (r) => {
      e._x_transition.enter.start = r;
    },
    "enter-end": (r) => {
      e._x_transition.enter.end = r;
    },
    leave: (r) => {
      e._x_transition.leave.during = r;
    },
    "leave-start": (r) => {
      e._x_transition.leave.start = r;
    },
    "leave-end": (r) => {
      e._x_transition.leave.end = r;
    }
  }[n](t);
}
function registerTransitionsFromHelper(e, t, n) {
  registerTransitionObject(e, setStyles);
  let i = !t.includes("in") && !t.includes("out") && !n, r = i || t.includes("in") || ["enter"].includes(n), a = i || t.includes("out") || ["leave"].includes(n);
  t.includes("in") && !i && (t = t.filter((E, g) => g < t.indexOf("out"))), t.includes("out") && !i && (t = t.filter((E, g) => g > t.indexOf("out")));
  let s = !t.includes("opacity") && !t.includes("scale"), o = s || t.includes("opacity"), l = s || t.includes("scale"), c = o ? 0 : 1, u = l ? modifierValue(t, "scale", 95) / 100 : 1, d = modifierValue(t, "delay", 0) / 1e3, h = modifierValue(t, "origin", "center"), b = "opacity, transform", v = modifierValue(t, "duration", 150) / 1e3, x = modifierValue(t, "duration", 75) / 1e3, m = "cubic-bezier(0.4, 0.0, 0.2, 1)";
  r && (e._x_transition.enter.during = {
    transformOrigin: h,
    transitionDelay: `${d}s`,
    transitionProperty: b,
    transitionDuration: `${v}s`,
    transitionTimingFunction: m
  }, e._x_transition.enter.start = {
    opacity: c,
    transform: `scale(${u})`
  }, e._x_transition.enter.end = {
    opacity: 1,
    transform: "scale(1)"
  }), a && (e._x_transition.leave.during = {
    transformOrigin: h,
    transitionDelay: `${d}s`,
    transitionProperty: b,
    transitionDuration: `${x}s`,
    transitionTimingFunction: m
  }, e._x_transition.leave.start = {
    opacity: 1,
    transform: "scale(1)"
  }, e._x_transition.leave.end = {
    opacity: c,
    transform: `scale(${u})`
  });
}
function registerTransitionObject(e, t, n = {}) {
  e._x_transition || (e._x_transition = {
    enter: { during: n, start: n, end: n },
    leave: { during: n, start: n, end: n },
    in(i = () => {
    }, r = () => {
    }) {
      transition(e, t, {
        during: this.enter.during,
        start: this.enter.start,
        end: this.enter.end
      }, i, r);
    },
    out(i = () => {
    }, r = () => {
    }) {
      transition(e, t, {
        during: this.leave.during,
        start: this.leave.start,
        end: this.leave.end
      }, i, r);
    }
  });
}
window.Element.prototype._x_toggleAndCascadeWithTransitions = function(e, t, n, i) {
  const r = document.visibilityState === "visible" ? requestAnimationFrame : setTimeout;
  let a = () => r(n);
  if (t) {
    e._x_transition && (e._x_transition.enter || e._x_transition.leave) ? e._x_transition.enter && (Object.entries(e._x_transition.enter.during).length || Object.entries(e._x_transition.enter.start).length || Object.entries(e._x_transition.enter.end).length) ? e._x_transition.in(n) : a() : e._x_transition ? e._x_transition.in(n) : a();
    return;
  }
  e._x_hidePromise = e._x_transition ? new Promise((s, o) => {
    e._x_transition.out(() => {
    }, () => s(i)), e._x_transitioning && e._x_transitioning.beforeCancel(() => o({ isFromCancelledTransition: !0 }));
  }) : Promise.resolve(i), queueMicrotask(() => {
    let s = closestHide(e);
    s ? (s._x_hideChildren || (s._x_hideChildren = []), s._x_hideChildren.push(e)) : r(() => {
      let o = (l) => {
        let c = Promise.all([
          l._x_hidePromise,
          ...(l._x_hideChildren || []).map(o)
        ]).then(([u]) => u?.());
        return delete l._x_hidePromise, delete l._x_hideChildren, c;
      };
      o(e).catch((l) => {
        if (!l.isFromCancelledTransition)
          throw l;
      });
    });
  });
};
function closestHide(e) {
  let t = e.parentNode;
  if (t)
    return t._x_hidePromise ? t : closestHide(t);
}
function transition(e, t, { during: n, start: i, end: r } = {}, a = () => {
}, s = () => {
}) {
  if (e._x_transitioning && e._x_transitioning.cancel(), Object.keys(n).length === 0 && Object.keys(i).length === 0 && Object.keys(r).length === 0) {
    a(), s();
    return;
  }
  let o, l, c;
  performTransition(e, {
    start() {
      o = t(e, i);
    },
    during() {
      l = t(e, n);
    },
    before: a,
    end() {
      o(), c = t(e, r);
    },
    after: s,
    cleanup() {
      l(), c();
    }
  });
}
function performTransition(e, t) {
  let n, i, r, a = once(() => {
    mutateDom(() => {
      n = !0, i || t.before(), r || (t.end(), releaseNextTicks()), t.after(), e.isConnected && t.cleanup(), delete e._x_transitioning;
    });
  });
  e._x_transitioning = {
    beforeCancels: [],
    beforeCancel(s) {
      this.beforeCancels.push(s);
    },
    cancel: once(function() {
      for (; this.beforeCancels.length; )
        this.beforeCancels.shift()();
      a();
    }),
    finish: a
  }, mutateDom(() => {
    t.start(), t.during();
  }), holdNextTicks(), requestAnimationFrame(() => {
    if (n)
      return;
    let s = Number(getComputedStyle(e).transitionDuration.replace(/,.*/, "").replace("s", "")) * 1e3, o = Number(getComputedStyle(e).transitionDelay.replace(/,.*/, "").replace("s", "")) * 1e3;
    s === 0 && (s = Number(getComputedStyle(e).animationDuration.replace("s", "")) * 1e3), mutateDom(() => {
      t.before();
    }), i = !0, requestAnimationFrame(() => {
      n || (mutateDom(() => {
        t.end();
      }), releaseNextTicks(), setTimeout(e._x_transitioning.finish, s + o), r = !0);
    });
  });
}
function modifierValue(e, t, n) {
  if (e.indexOf(t) === -1)
    return n;
  const i = e[e.indexOf(t) + 1];
  if (!i || t === "scale" && isNaN(i))
    return n;
  if (t === "duration" || t === "delay") {
    let r = i.match(/([0-9]+)ms/);
    if (r)
      return r[1];
  }
  return t === "origin" && ["top", "right", "left", "center", "bottom"].includes(e[e.indexOf(t) + 2]) ? [i, e[e.indexOf(t) + 2]].join(" ") : i;
}
var isCloning = !1;
function skipDuringClone(e, t = () => {
}) {
  return (...n) => isCloning ? t(...n) : e(...n);
}
function onlyDuringClone(e) {
  return (...t) => isCloning && e(...t);
}
var interceptors = [];
function interceptClone(e) {
  interceptors.push(e);
}
function cloneNode(e, t) {
  interceptors.forEach((n) => n(e, t)), isCloning = !0, dontRegisterReactiveSideEffects(() => {
    initTree(t, (n, i) => {
      i(n, () => {
      });
    });
  }), isCloning = !1;
}
var isCloningLegacy = !1;
function clone(e, t) {
  t._x_dataStack || (t._x_dataStack = e._x_dataStack), isCloning = !0, isCloningLegacy = !0, dontRegisterReactiveSideEffects(() => {
    cloneTree(t);
  }), isCloning = !1, isCloningLegacy = !1;
}
function cloneTree(e) {
  let t = !1;
  initTree(e, (i, r) => {
    walk(i, (a, s) => {
      if (t && isRoot(a))
        return s();
      t = !0, r(a, s);
    });
  });
}
function dontRegisterReactiveSideEffects(e) {
  let t = effect$3;
  overrideEffect((n, i) => {
    let r = t(n);
    return release(r), () => {
    };
  }), e(), overrideEffect(t);
}
function bind(e, t, n, i = []) {
  switch (e._x_bindings || (e._x_bindings = reactive({})), e._x_bindings[t] = n, t = i.includes("camel") ? camelCase(t) : t, t) {
    case "value":
      bindInputValue(e, n);
      break;
    case "style":
      bindStyles(e, n);
      break;
    case "class":
      bindClasses(e, n);
      break;
    case "selected":
    case "checked":
      bindAttributeAndProperty(e, t, n);
      break;
    default:
      bindAttribute(e, t, n);
      break;
  }
}
function bindInputValue(e, t) {
  if (isRadio(e))
    e.attributes.value === void 0 && (e.value = t), window.fromModel && (typeof t == "boolean" ? e.checked = safeParseBoolean(e.value) === t : e.checked = checkedAttrLooseCompare(e.value, t));
  else if (isCheckbox(e))
    Number.isInteger(t) ? e.value = t : !Array.isArray(t) && typeof t != "boolean" && ![null, void 0].includes(t) ? e.value = String(t) : Array.isArray(t) ? e.checked = t.some((n) => checkedAttrLooseCompare(n, e.value)) : e.checked = !!t;
  else if (e.tagName === "SELECT")
    updateSelect(e, t);
  else {
    if (e.value === t)
      return;
    e.value = t === void 0 ? "" : t;
  }
}
function bindClasses(e, t) {
  e._x_undoAddedClasses && e._x_undoAddedClasses(), e._x_undoAddedClasses = setClasses(e, t);
}
function bindStyles(e, t) {
  e._x_undoAddedStyles && e._x_undoAddedStyles(), e._x_undoAddedStyles = setStyles(e, t);
}
function bindAttributeAndProperty(e, t, n) {
  bindAttribute(e, t, n), setPropertyIfChanged(e, t, n);
}
function bindAttribute(e, t, n) {
  [null, void 0, !1].includes(n) && attributeShouldntBePreservedIfFalsy(t) ? e.removeAttribute(t) : (isBooleanAttr(t) && (n = t), setIfChanged(e, t, n));
}
function setIfChanged(e, t, n) {
  e.getAttribute(t) != n && e.setAttribute(t, n);
}
function setPropertyIfChanged(e, t, n) {
  e[t] !== n && (e[t] = n);
}
function updateSelect(e, t) {
  const n = [].concat(t).map((i) => i + "");
  Array.from(e.options).forEach((i) => {
    i.selected = n.includes(i.value);
  });
}
function camelCase(e) {
  return e.toLowerCase().replace(/-(\w)/g, (t, n) => n.toUpperCase());
}
function checkedAttrLooseCompare(e, t) {
  return e == t;
}
function safeParseBoolean(e) {
  return [1, "1", "true", "on", "yes", !0].includes(e) ? !0 : [0, "0", "false", "off", "no", !1].includes(e) ? !1 : e ? !!e : null;
}
var booleanAttributes = /* @__PURE__ */ new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected",
  "shadowrootclonable",
  "shadowrootdelegatesfocus",
  "shadowrootserializable"
]);
function isBooleanAttr(e) {
  return booleanAttributes.has(e);
}
function attributeShouldntBePreservedIfFalsy(e) {
  return !["aria-pressed", "aria-checked", "aria-expanded", "aria-selected"].includes(e);
}
function getBinding(e, t, n) {
  return e._x_bindings && e._x_bindings[t] !== void 0 ? e._x_bindings[t] : getAttributeBinding(e, t, n);
}
function extractProp(e, t, n, i = !0) {
  if (e._x_bindings && e._x_bindings[t] !== void 0)
    return e._x_bindings[t];
  if (e._x_inlineBindings && e._x_inlineBindings[t] !== void 0) {
    let r = e._x_inlineBindings[t];
    return r.extract = i, dontAutoEvaluateFunctions(() => evaluate(e, r.expression));
  }
  return getAttributeBinding(e, t, n);
}
function getAttributeBinding(e, t, n) {
  let i = e.getAttribute(t);
  return i === null ? typeof n == "function" ? n() : n : i === "" ? !0 : isBooleanAttr(t) ? !![t, "true"].includes(i) : i;
}
function isCheckbox(e) {
  return e.type === "checkbox" || e.localName === "ui-checkbox" || e.localName === "ui-switch";
}
function isRadio(e) {
  return e.type === "radio" || e.localName === "ui-radio";
}
function debounce$1(e, t) {
  let n;
  return function() {
    const i = this, r = arguments, a = function() {
      n = null, e.apply(i, r);
    };
    clearTimeout(n), n = setTimeout(a, t);
  };
}
function throttle(e, t) {
  let n;
  return function() {
    let i = this, r = arguments;
    n || (e.apply(i, r), n = !0, setTimeout(() => n = !1, t));
  };
}
function entangle({ get: e, set: t }, { get: n, set: i }) {
  let r = !0, a, s = effect$3(() => {
    let o = e(), l = n();
    if (r)
      i(cloneIfObject(o)), r = !1;
    else {
      let c = JSON.stringify(o), u = JSON.stringify(l);
      c !== a ? i(cloneIfObject(o)) : c !== u && t(cloneIfObject(l));
    }
    a = JSON.stringify(e()), JSON.stringify(n());
  });
  return () => {
    release(s);
  };
}
function cloneIfObject(e) {
  return typeof e == "object" ? JSON.parse(JSON.stringify(e)) : e;
}
function plugin(e) {
  (Array.isArray(e) ? e : [e]).forEach((n) => n(alpine_default));
}
var stores = {}, isReactive = !1;
function store(e, t) {
  if (isReactive || (stores = reactive(stores), isReactive = !0), t === void 0)
    return stores[e];
  stores[e] = t, initInterceptors(stores[e]), typeof t == "object" && t !== null && t.hasOwnProperty("init") && typeof t.init == "function" && stores[e].init();
}
function getStores() {
  return stores;
}
var binds = {};
function bind2(e, t) {
  let n = typeof t != "function" ? () => t : t;
  return e instanceof Element ? applyBindingsObject(e, n()) : (binds[e] = n, () => {
  });
}
function injectBindingProviders(e) {
  return Object.entries(binds).forEach(([t, n]) => {
    Object.defineProperty(e, t, {
      get() {
        return (...i) => n(...i);
      }
    });
  }), e;
}
function applyBindingsObject(e, t, n) {
  let i = [];
  for (; i.length; )
    i.pop()();
  let r = Object.entries(t).map(([s, o]) => ({ name: s, value: o })), a = attributesOnly(r);
  return r = r.map((s) => a.find((o) => o.name === s.name) ? {
    name: `x-bind:${s.name}`,
    value: `"${s.value}"`
  } : s), directives(e, r, n).map((s) => {
    i.push(s.runCleanups), s();
  }), () => {
    for (; i.length; )
      i.pop()();
  };
}
var datas = {};
function data(e, t) {
  datas[e] = t;
}
function injectDataProviders(e, t) {
  return Object.entries(datas).forEach(([n, i]) => {
    Object.defineProperty(e, n, {
      get() {
        return (...r) => i.bind(t)(...r);
      },
      enumerable: !1
    });
  }), e;
}
var Alpine = {
  get reactive() {
    return reactive;
  },
  get release() {
    return release;
  },
  get effect() {
    return effect$3;
  },
  get raw() {
    return raw;
  },
  version: "3.15.2",
  flushAndStopDeferringMutations,
  dontAutoEvaluateFunctions,
  disableEffectScheduling,
  startObservingMutations,
  stopObservingMutations,
  setReactivityEngine,
  onAttributeRemoved,
  onAttributesAdded,
  closestDataStack,
  skipDuringClone,
  onlyDuringClone,
  addRootSelector,
  addInitSelector,
  setErrorHandler,
  interceptClone,
  addScopeToNode,
  deferMutations,
  mapAttributes,
  evaluateLater,
  interceptInit,
  setEvaluator,
  mergeProxies,
  extractProp,
  findClosest,
  onElRemoved,
  closestRoot,
  destroyTree,
  interceptor,
  // INTERNAL: not public API and is subject to change without major release.
  transition,
  // INTERNAL
  setStyles,
  // INTERNAL
  mutateDom,
  directive,
  entangle,
  throttle,
  debounce: debounce$1,
  evaluate,
  initTree,
  nextTick,
  prefixed: prefix,
  prefix: setPrefix,
  plugin,
  magic,
  store,
  start: start$1,
  clone,
  // INTERNAL
  cloneNode,
  // INTERNAL
  bound: getBinding,
  $data: scope,
  watch,
  walk,
  data,
  bind: bind2
}, alpine_default = Alpine;
function makeMap(e, t) {
  const n = /* @__PURE__ */ Object.create(null), i = e.split(",");
  for (let r = 0; r < i.length; r++)
    n[i[r]] = !0;
  return (r) => !!n[r];
}
var EMPTY_OBJ = Object.freeze({}), hasOwnProperty = Object.prototype.hasOwnProperty, hasOwn = (e, t) => hasOwnProperty.call(e, t), isArray = Array.isArray, isMap = (e) => toTypeString(e) === "[object Map]", isString = (e) => typeof e == "string", isSymbol = (e) => typeof e == "symbol", isObject = (e) => e !== null && typeof e == "object", objectToString = Object.prototype.toString, toTypeString = (e) => objectToString.call(e), toRawType = (e) => toTypeString(e).slice(8, -1), isIntegerKey = (e) => isString(e) && e !== "NaN" && e[0] !== "-" && "" + parseInt(e, 10) === e, cacheStringFunction = (e) => {
  const t = /* @__PURE__ */ Object.create(null);
  return (n) => t[n] || (t[n] = e(n));
}, capitalize = cacheStringFunction((e) => e.charAt(0).toUpperCase() + e.slice(1)), hasChanged = (e, t) => e !== t && (e === e || t === t), targetMap = /* @__PURE__ */ new WeakMap(), effectStack = [], activeEffect, ITERATE_KEY = Symbol("iterate"), MAP_KEY_ITERATE_KEY = Symbol("Map key iterate");
function isEffect(e) {
  return e && e._isEffect === !0;
}
function effect2(e, t = EMPTY_OBJ) {
  isEffect(e) && (e = e.raw);
  const n = createReactiveEffect(e, t);
  return t.lazy || n(), n;
}
function stop(e) {
  e.active && (cleanup(e), e.options.onStop && e.options.onStop(), e.active = !1);
}
var uid = 0;
function createReactiveEffect(e, t) {
  const n = function() {
    if (!n.active)
      return e();
    if (!effectStack.includes(n)) {
      cleanup(n);
      try {
        return enableTracking(), effectStack.push(n), activeEffect = n, e();
      } finally {
        effectStack.pop(), resetTracking(), activeEffect = effectStack[effectStack.length - 1];
      }
    }
  };
  return n.id = uid++, n.allowRecurse = !!t.allowRecurse, n._isEffect = !0, n.active = !0, n.raw = e, n.deps = [], n.options = t, n;
}
function cleanup(e) {
  const { deps: t } = e;
  if (t.length) {
    for (let n = 0; n < t.length; n++)
      t[n].delete(e);
    t.length = 0;
  }
}
var shouldTrack = !0, trackStack = [];
function pauseTracking() {
  trackStack.push(shouldTrack), shouldTrack = !1;
}
function enableTracking() {
  trackStack.push(shouldTrack), shouldTrack = !0;
}
function resetTracking() {
  const e = trackStack.pop();
  shouldTrack = e === void 0 ? !0 : e;
}
function track(e, t, n) {
  if (!shouldTrack || activeEffect === void 0)
    return;
  let i = targetMap.get(e);
  i || targetMap.set(e, i = /* @__PURE__ */ new Map());
  let r = i.get(n);
  r || i.set(n, r = /* @__PURE__ */ new Set()), r.has(activeEffect) || (r.add(activeEffect), activeEffect.deps.push(r), activeEffect.options.onTrack && activeEffect.options.onTrack({
    effect: activeEffect,
    target: e,
    type: t,
    key: n
  }));
}
function trigger(e, t, n, i, r, a) {
  const s = targetMap.get(e);
  if (!s)
    return;
  const o = /* @__PURE__ */ new Set(), l = (u) => {
    u && u.forEach((d) => {
      (d !== activeEffect || d.allowRecurse) && o.add(d);
    });
  };
  if (t === "clear")
    s.forEach(l);
  else if (n === "length" && isArray(e))
    s.forEach((u, d) => {
      (d === "length" || d >= i) && l(u);
    });
  else
    switch (n !== void 0 && l(s.get(n)), t) {
      case "add":
        isArray(e) ? isIntegerKey(n) && l(s.get("length")) : (l(s.get(ITERATE_KEY)), isMap(e) && l(s.get(MAP_KEY_ITERATE_KEY)));
        break;
      case "delete":
        isArray(e) || (l(s.get(ITERATE_KEY)), isMap(e) && l(s.get(MAP_KEY_ITERATE_KEY)));
        break;
      case "set":
        isMap(e) && l(s.get(ITERATE_KEY));
        break;
    }
  const c = (u) => {
    u.options.onTrigger && u.options.onTrigger({
      effect: u,
      target: e,
      key: n,
      type: t,
      newValue: i,
      oldValue: r,
      oldTarget: a
    }), u.options.scheduler ? u.options.scheduler(u) : u();
  };
  o.forEach(c);
}
var isNonTrackableKeys = /* @__PURE__ */ makeMap("__proto__,__v_isRef,__isVue"), builtInSymbols = new Set(Object.getOwnPropertyNames(Symbol).map((e) => Symbol[e]).filter(isSymbol)), get2 = /* @__PURE__ */ createGetter(), readonlyGet = /* @__PURE__ */ createGetter(!0), arrayInstrumentations = /* @__PURE__ */ createArrayInstrumentations();
function createArrayInstrumentations() {
  const e = {};
  return ["includes", "indexOf", "lastIndexOf"].forEach((t) => {
    e[t] = function(...n) {
      const i = toRaw(this);
      for (let a = 0, s = this.length; a < s; a++)
        track(i, "get", a + "");
      const r = i[t](...n);
      return r === -1 || r === !1 ? i[t](...n.map(toRaw)) : r;
    };
  }), ["push", "pop", "shift", "unshift", "splice"].forEach((t) => {
    e[t] = function(...n) {
      pauseTracking();
      const i = toRaw(this)[t].apply(this, n);
      return resetTracking(), i;
    };
  }), e;
}
function createGetter(e = !1, t = !1) {
  return function(i, r, a) {
    if (r === "__v_isReactive")
      return !e;
    if (r === "__v_isReadonly")
      return e;
    if (r === "__v_raw" && a === (e ? t ? shallowReadonlyMap : readonlyMap : t ? shallowReactiveMap : reactiveMap).get(i))
      return i;
    const s = isArray(i);
    if (!e && s && hasOwn(arrayInstrumentations, r))
      return Reflect.get(arrayInstrumentations, r, a);
    const o = Reflect.get(i, r, a);
    return (isSymbol(r) ? builtInSymbols.has(r) : isNonTrackableKeys(r)) || (e || track(i, "get", r), t) ? o : isRef(o) ? !s || !isIntegerKey(r) ? o.value : o : isObject(o) ? e ? readonly(o) : reactive2(o) : o;
  };
}
var set2 = /* @__PURE__ */ createSetter();
function createSetter(e = !1) {
  return function(n, i, r, a) {
    let s = n[i];
    if (!e && (r = toRaw(r), s = toRaw(s), !isArray(n) && isRef(s) && !isRef(r)))
      return s.value = r, !0;
    const o = isArray(n) && isIntegerKey(i) ? Number(i) < n.length : hasOwn(n, i), l = Reflect.set(n, i, r, a);
    return n === toRaw(a) && (o ? hasChanged(r, s) && trigger(n, "set", i, r, s) : trigger(n, "add", i, r)), l;
  };
}
function deleteProperty(e, t) {
  const n = hasOwn(e, t), i = e[t], r = Reflect.deleteProperty(e, t);
  return r && n && trigger(e, "delete", t, void 0, i), r;
}
function has(e, t) {
  const n = Reflect.has(e, t);
  return (!isSymbol(t) || !builtInSymbols.has(t)) && track(e, "has", t), n;
}
function ownKeys(e) {
  return track(e, "iterate", isArray(e) ? "length" : ITERATE_KEY), Reflect.ownKeys(e);
}
var mutableHandlers = {
  get: get2,
  set: set2,
  deleteProperty,
  has,
  ownKeys
}, readonlyHandlers = {
  get: readonlyGet,
  set(e, t) {
    return console.warn(`Set operation on key "${String(t)}" failed: target is readonly.`, e), !0;
  },
  deleteProperty(e, t) {
    return console.warn(`Delete operation on key "${String(t)}" failed: target is readonly.`, e), !0;
  }
}, toReactive = (e) => isObject(e) ? reactive2(e) : e, toReadonly = (e) => isObject(e) ? readonly(e) : e, toShallow = (e) => e, getProto = (e) => Reflect.getPrototypeOf(e);
function get$1(e, t, n = !1, i = !1) {
  e = e.__v_raw;
  const r = toRaw(e), a = toRaw(t);
  t !== a && !n && track(r, "get", t), !n && track(r, "get", a);
  const { has: s } = getProto(r), o = i ? toShallow : n ? toReadonly : toReactive;
  if (s.call(r, t))
    return o(e.get(t));
  if (s.call(r, a))
    return o(e.get(a));
  e !== r && e.get(t);
}
function has$1(e, t = !1) {
  const n = this.__v_raw, i = toRaw(n), r = toRaw(e);
  return e !== r && !t && track(i, "has", e), !t && track(i, "has", r), e === r ? n.has(e) : n.has(e) || n.has(r);
}
function size(e, t = !1) {
  return e = e.__v_raw, !t && track(toRaw(e), "iterate", ITERATE_KEY), Reflect.get(e, "size", e);
}
function add(e) {
  e = toRaw(e);
  const t = toRaw(this);
  return getProto(t).has.call(t, e) || (t.add(e), trigger(t, "add", e, e)), this;
}
function set$1(e, t) {
  t = toRaw(t);
  const n = toRaw(this), { has: i, get: r } = getProto(n);
  let a = i.call(n, e);
  a ? checkIdentityKeys(n, i, e) : (e = toRaw(e), a = i.call(n, e));
  const s = r.call(n, e);
  return n.set(e, t), a ? hasChanged(t, s) && trigger(n, "set", e, t, s) : trigger(n, "add", e, t), this;
}
function deleteEntry(e) {
  const t = toRaw(this), { has: n, get: i } = getProto(t);
  let r = n.call(t, e);
  r ? checkIdentityKeys(t, n, e) : (e = toRaw(e), r = n.call(t, e));
  const a = i ? i.call(t, e) : void 0, s = t.delete(e);
  return r && trigger(t, "delete", e, void 0, a), s;
}
function clear() {
  const e = toRaw(this), t = e.size !== 0, n = isMap(e) ? new Map(e) : new Set(e), i = e.clear();
  return t && trigger(e, "clear", void 0, void 0, n), i;
}
function createForEach(e, t) {
  return function(i, r) {
    const a = this, s = a.__v_raw, o = toRaw(s), l = t ? toShallow : e ? toReadonly : toReactive;
    return !e && track(o, "iterate", ITERATE_KEY), s.forEach((c, u) => i.call(r, l(c), l(u), a));
  };
}
function createIterableMethod(e, t, n) {
  return function(...i) {
    const r = this.__v_raw, a = toRaw(r), s = isMap(a), o = e === "entries" || e === Symbol.iterator && s, l = e === "keys" && s, c = r[e](...i), u = n ? toShallow : t ? toReadonly : toReactive;
    return !t && track(a, "iterate", l ? MAP_KEY_ITERATE_KEY : ITERATE_KEY), {
      // iterator protocol
      next() {
        const { value: d, done: h } = c.next();
        return h ? { value: d, done: h } : {
          value: o ? [u(d[0]), u(d[1])] : u(d),
          done: h
        };
      },
      // iterable protocol
      [Symbol.iterator]() {
        return this;
      }
    };
  };
}
function createReadonlyMethod(e) {
  return function(...t) {
    {
      const n = t[0] ? `on key "${t[0]}" ` : "";
      console.warn(`${capitalize(e)} operation ${n}failed: target is readonly.`, toRaw(this));
    }
    return e === "delete" ? !1 : this;
  };
}
function createInstrumentations() {
  const e = {
    get(a) {
      return get$1(this, a);
    },
    get size() {
      return size(this);
    },
    has: has$1,
    add,
    set: set$1,
    delete: deleteEntry,
    clear,
    forEach: createForEach(!1, !1)
  }, t = {
    get(a) {
      return get$1(this, a, !1, !0);
    },
    get size() {
      return size(this);
    },
    has: has$1,
    add,
    set: set$1,
    delete: deleteEntry,
    clear,
    forEach: createForEach(!1, !0)
  }, n = {
    get(a) {
      return get$1(this, a, !0);
    },
    get size() {
      return size(this, !0);
    },
    has(a) {
      return has$1.call(this, a, !0);
    },
    add: createReadonlyMethod(
      "add"
      /* ADD */
    ),
    set: createReadonlyMethod(
      "set"
      /* SET */
    ),
    delete: createReadonlyMethod(
      "delete"
      /* DELETE */
    ),
    clear: createReadonlyMethod(
      "clear"
      /* CLEAR */
    ),
    forEach: createForEach(!0, !1)
  }, i = {
    get(a) {
      return get$1(this, a, !0, !0);
    },
    get size() {
      return size(this, !0);
    },
    has(a) {
      return has$1.call(this, a, !0);
    },
    add: createReadonlyMethod(
      "add"
      /* ADD */
    ),
    set: createReadonlyMethod(
      "set"
      /* SET */
    ),
    delete: createReadonlyMethod(
      "delete"
      /* DELETE */
    ),
    clear: createReadonlyMethod(
      "clear"
      /* CLEAR */
    ),
    forEach: createForEach(!0, !0)
  };
  return ["keys", "values", "entries", Symbol.iterator].forEach((a) => {
    e[a] = createIterableMethod(a, !1, !1), n[a] = createIterableMethod(a, !0, !1), t[a] = createIterableMethod(a, !1, !0), i[a] = createIterableMethod(a, !0, !0);
  }), [
    e,
    n,
    t,
    i
  ];
}
var [mutableInstrumentations, readonlyInstrumentations] = /* @__PURE__ */ createInstrumentations();
function createInstrumentationGetter(e, t) {
  const n = e ? readonlyInstrumentations : mutableInstrumentations;
  return (i, r, a) => r === "__v_isReactive" ? !e : r === "__v_isReadonly" ? e : r === "__v_raw" ? i : Reflect.get(hasOwn(n, r) && r in i ? n : i, r, a);
}
var mutableCollectionHandlers = {
  get: /* @__PURE__ */ createInstrumentationGetter(!1)
}, readonlyCollectionHandlers = {
  get: /* @__PURE__ */ createInstrumentationGetter(!0)
};
function checkIdentityKeys(e, t, n) {
  const i = toRaw(n);
  if (i !== n && t.call(e, i)) {
    const r = toRawType(e);
    console.warn(`Reactive ${r} contains both the raw and reactive versions of the same object${r === "Map" ? " as keys" : ""}, which can lead to inconsistencies. Avoid differentiating between the raw and reactive versions of an object and only use the reactive version if possible.`);
  }
}
var reactiveMap = /* @__PURE__ */ new WeakMap(), shallowReactiveMap = /* @__PURE__ */ new WeakMap(), readonlyMap = /* @__PURE__ */ new WeakMap(), shallowReadonlyMap = /* @__PURE__ */ new WeakMap();
function targetTypeMap(e) {
  switch (e) {
    case "Object":
    case "Array":
      return 1;
    case "Map":
    case "Set":
    case "WeakMap":
    case "WeakSet":
      return 2;
    default:
      return 0;
  }
}
function getTargetType(e) {
  return e.__v_skip || !Object.isExtensible(e) ? 0 : targetTypeMap(toRawType(e));
}
function reactive2(e) {
  return e && e.__v_isReadonly ? e : createReactiveObject(e, !1, mutableHandlers, mutableCollectionHandlers, reactiveMap);
}
function readonly(e) {
  return createReactiveObject(e, !0, readonlyHandlers, readonlyCollectionHandlers, readonlyMap);
}
function createReactiveObject(e, t, n, i, r) {
  if (!isObject(e))
    return console.warn(`value cannot be made reactive: ${String(e)}`), e;
  if (e.__v_raw && !(t && e.__v_isReactive))
    return e;
  const a = r.get(e);
  if (a)
    return a;
  const s = getTargetType(e);
  if (s === 0)
    return e;
  const o = new Proxy(e, s === 2 ? i : n);
  return r.set(e, o), o;
}
function toRaw(e) {
  return e && toRaw(e.__v_raw) || e;
}
function isRef(e) {
  return !!(e && e.__v_isRef === !0);
}
magic("nextTick", () => nextTick);
magic("dispatch", (e) => dispatch.bind(dispatch, e));
magic("watch", (e, { evaluateLater: t, cleanup: n }) => (i, r) => {
  let a = t(i), o = watch(() => {
    let l;
    return a((c) => l = c), l;
  }, r);
  n(o);
});
magic("store", getStores);
magic("data", (e) => scope(e));
magic("root", (e) => closestRoot(e));
magic("refs", (e) => (e._x_refs_proxy || (e._x_refs_proxy = mergeProxies(getArrayOfRefObject(e))), e._x_refs_proxy));
function getArrayOfRefObject(e) {
  let t = [];
  return findClosest(e, (n) => {
    n._x_refs && t.push(n._x_refs);
  }), t;
}
var globalIdMemo = {};
function findAndIncrementId(e) {
  return globalIdMemo[e] || (globalIdMemo[e] = 0), ++globalIdMemo[e];
}
function closestIdRoot(e, t) {
  return findClosest(e, (n) => {
    if (n._x_ids && n._x_ids[t])
      return !0;
  });
}
function setIdRoot(e, t) {
  e._x_ids || (e._x_ids = {}), e._x_ids[t] || (e._x_ids[t] = findAndIncrementId(t));
}
magic("id", (e, { cleanup: t }) => (n, i = null) => {
  let r = `${n}${i ? `-${i}` : ""}`;
  return cacheIdByNameOnElement(e, r, t, () => {
    let a = closestIdRoot(e, n), s = a ? a._x_ids[n] : findAndIncrementId(n);
    return i ? `${n}-${s}-${i}` : `${n}-${s}`;
  });
});
interceptClone((e, t) => {
  e._x_id && (t._x_id = e._x_id);
});
function cacheIdByNameOnElement(e, t, n, i) {
  if (e._x_id || (e._x_id = {}), e._x_id[t])
    return e._x_id[t];
  let r = i();
  return e._x_id[t] = r, n(() => {
    delete e._x_id[t];
  }), r;
}
magic("el", (e) => e);
warnMissingPluginMagic("Focus", "focus", "focus");
warnMissingPluginMagic("Persist", "persist", "persist");
function warnMissingPluginMagic(e, t, n) {
  magic(t, (i) => warn(`You can't use [$${t}] without first installing the "${e}" plugin here: https://alpinejs.dev/plugins/${n}`, i));
}
directive("modelable", (e, { expression: t }, { effect: n, evaluateLater: i, cleanup: r }) => {
  let a = i(t), s = () => {
    let u;
    return a((d) => u = d), u;
  }, o = i(`${t} = __placeholder`), l = (u) => o(() => {
  }, { scope: { __placeholder: u } }), c = s();
  l(c), queueMicrotask(() => {
    if (!e._x_model)
      return;
    e._x_removeModelListeners.default();
    let u = e._x_model.get, d = e._x_model.set, h = entangle(
      {
        get() {
          return u();
        },
        set(b) {
          d(b);
        }
      },
      {
        get() {
          return s();
        },
        set(b) {
          l(b);
        }
      }
    );
    r(h);
  });
});
directive("teleport", (e, { modifiers: t, expression: n }, { cleanup: i }) => {
  e.tagName.toLowerCase() !== "template" && warn("x-teleport can only be used on a <template> tag", e);
  let r = getTarget(n), a = e.content.cloneNode(!0).firstElementChild;
  e._x_teleport = a, a._x_teleportBack = e, e.setAttribute("data-teleport-template", !0), a.setAttribute("data-teleport-target", !0), e._x_forwardEvents && e._x_forwardEvents.forEach((o) => {
    a.addEventListener(o, (l) => {
      l.stopPropagation(), e.dispatchEvent(new l.constructor(l.type, l));
    });
  }), addScopeToNode(a, {}, e);
  let s = (o, l, c) => {
    c.includes("prepend") ? l.parentNode.insertBefore(o, l) : c.includes("append") ? l.parentNode.insertBefore(o, l.nextSibling) : l.appendChild(o);
  };
  mutateDom(() => {
    s(a, r, t), skipDuringClone(() => {
      initTree(a);
    })();
  }), e._x_teleportPutBack = () => {
    let o = getTarget(n);
    mutateDom(() => {
      s(e._x_teleport, o, t);
    });
  }, i(
    () => mutateDom(() => {
      a.remove(), destroyTree(a);
    })
  );
});
var teleportContainerDuringClone = document.createElement("div");
function getTarget(e) {
  let t = skipDuringClone(() => document.querySelector(e), () => teleportContainerDuringClone)();
  return t || warn(`Cannot find x-teleport element for selector: "${e}"`), t;
}
var handler = () => {
};
handler.inline = (e, { modifiers: t }, { cleanup: n }) => {
  t.includes("self") ? e._x_ignoreSelf = !0 : e._x_ignore = !0, n(() => {
    t.includes("self") ? delete e._x_ignoreSelf : delete e._x_ignore;
  });
};
directive("ignore", handler);
directive("effect", skipDuringClone((e, { expression: t }, { effect: n }) => {
  n(evaluateLater(e, t));
}));
function on(e, t, n, i) {
  let r = e, a = (l) => i(l), s = {}, o = (l, c) => (u) => c(l, u);
  if (n.includes("dot") && (t = dotSyntax(t)), n.includes("camel") && (t = camelCase2(t)), n.includes("passive") && (s.passive = !0), n.includes("capture") && (s.capture = !0), n.includes("window") && (r = window), n.includes("document") && (r = document), n.includes("debounce")) {
    let l = n[n.indexOf("debounce") + 1] || "invalid-wait", c = isNumeric(l.split("ms")[0]) ? Number(l.split("ms")[0]) : 250;
    a = debounce$1(a, c);
  }
  if (n.includes("throttle")) {
    let l = n[n.indexOf("throttle") + 1] || "invalid-wait", c = isNumeric(l.split("ms")[0]) ? Number(l.split("ms")[0]) : 250;
    a = throttle(a, c);
  }
  return n.includes("prevent") && (a = o(a, (l, c) => {
    c.preventDefault(), l(c);
  })), n.includes("stop") && (a = o(a, (l, c) => {
    c.stopPropagation(), l(c);
  })), n.includes("once") && (a = o(a, (l, c) => {
    l(c), r.removeEventListener(t, a, s);
  })), (n.includes("away") || n.includes("outside")) && (r = document, a = o(a, (l, c) => {
    e.contains(c.target) || c.target.isConnected !== !1 && (e.offsetWidth < 1 && e.offsetHeight < 1 || e._x_isShown !== !1 && l(c));
  })), n.includes("self") && (a = o(a, (l, c) => {
    c.target === e && l(c);
  })), (isKeyEvent(t) || isClickEvent(t)) && (a = o(a, (l, c) => {
    isListeningForASpecificKeyThatHasntBeenPressed(c, n) || l(c);
  })), r.addEventListener(t, a, s), () => {
    r.removeEventListener(t, a, s);
  };
}
function dotSyntax(e) {
  return e.replace(/-/g, ".");
}
function camelCase2(e) {
  return e.toLowerCase().replace(/-(\w)/g, (t, n) => n.toUpperCase());
}
function isNumeric(e) {
  return !Array.isArray(e) && !isNaN(e);
}
function kebabCase2(e) {
  return [" ", "_"].includes(
    e
  ) ? e : e.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[_\s]/, "-").toLowerCase();
}
function isKeyEvent(e) {
  return ["keydown", "keyup"].includes(e);
}
function isClickEvent(e) {
  return ["contextmenu", "click", "mouse"].some((t) => e.includes(t));
}
function isListeningForASpecificKeyThatHasntBeenPressed(e, t) {
  let n = t.filter((a) => !["window", "document", "prevent", "stop", "once", "capture", "self", "away", "outside", "passive", "preserve-scroll"].includes(a));
  if (n.includes("debounce")) {
    let a = n.indexOf("debounce");
    n.splice(a, isNumeric((n[a + 1] || "invalid-wait").split("ms")[0]) ? 2 : 1);
  }
  if (n.includes("throttle")) {
    let a = n.indexOf("throttle");
    n.splice(a, isNumeric((n[a + 1] || "invalid-wait").split("ms")[0]) ? 2 : 1);
  }
  if (n.length === 0 || n.length === 1 && keyToModifiers(e.key).includes(n[0]))
    return !1;
  const r = ["ctrl", "shift", "alt", "meta", "cmd", "super"].filter((a) => n.includes(a));
  return n = n.filter((a) => !r.includes(a)), !(r.length > 0 && r.filter((s) => ((s === "cmd" || s === "super") && (s = "meta"), e[`${s}Key`])).length === r.length && (isClickEvent(e.type) || keyToModifiers(e.key).includes(n[0])));
}
function keyToModifiers(e) {
  if (!e)
    return [];
  e = kebabCase2(e);
  let t = {
    ctrl: "control",
    slash: "/",
    space: " ",
    spacebar: " ",
    cmd: "meta",
    esc: "escape",
    up: "arrow-up",
    down: "arrow-down",
    left: "arrow-left",
    right: "arrow-right",
    period: ".",
    comma: ",",
    equal: "=",
    minus: "-",
    underscore: "_"
  };
  return t[e] = e, Object.keys(t).map((n) => {
    if (t[n] === e)
      return n;
  }).filter((n) => n);
}
directive("model", (e, { modifiers: t, expression: n }, { effect: i, cleanup: r }) => {
  let a = e;
  t.includes("parent") && (a = e.parentNode);
  let s = evaluateLater(a, n), o;
  typeof n == "string" ? o = evaluateLater(a, `${n} = __placeholder`) : typeof n == "function" && typeof n() == "string" ? o = evaluateLater(a, `${n()} = __placeholder`) : o = () => {
  };
  let l = () => {
    let h;
    return s((b) => h = b), isGetterSetter(h) ? h.get() : h;
  }, c = (h) => {
    let b;
    s((v) => b = v), isGetterSetter(b) ? b.set(h) : o(() => {
    }, {
      scope: { __placeholder: h }
    });
  };
  typeof n == "string" && e.type === "radio" && mutateDom(() => {
    e.hasAttribute("name") || e.setAttribute("name", n);
  });
  let u = e.tagName.toLowerCase() === "select" || ["checkbox", "radio"].includes(e.type) || t.includes("lazy") ? "change" : "input", d = isCloning ? () => {
  } : on(e, u, t, (h) => {
    c(getInputValue(e, t, h, l()));
  });
  if (t.includes("fill") && ([void 0, null, ""].includes(l()) || isCheckbox(e) && Array.isArray(l()) || e.tagName.toLowerCase() === "select" && e.multiple) && c(
    getInputValue(e, t, { target: e }, l())
  ), e._x_removeModelListeners || (e._x_removeModelListeners = {}), e._x_removeModelListeners.default = d, r(() => e._x_removeModelListeners.default()), e.form) {
    let h = on(e.form, "reset", [], (b) => {
      nextTick(() => e._x_model && e._x_model.set(getInputValue(e, t, { target: e }, l())));
    });
    r(() => h());
  }
  e._x_model = {
    get() {
      return l();
    },
    set(h) {
      c(h);
    }
  }, e._x_forceModelUpdate = (h) => {
    h === void 0 && typeof n == "string" && n.match(/\./) && (h = ""), window.fromModel = !0, mutateDom(() => bind(e, "value", h)), delete window.fromModel;
  }, i(() => {
    let h = l();
    t.includes("unintrusive") && document.activeElement.isSameNode(e) || e._x_forceModelUpdate(h);
  });
});
function getInputValue(e, t, n, i) {
  return mutateDom(() => {
    if (n instanceof CustomEvent && n.detail !== void 0)
      return n.detail !== null && n.detail !== void 0 ? n.detail : n.target.value;
    if (isCheckbox(e))
      if (Array.isArray(i)) {
        let r = null;
        return t.includes("number") ? r = safeParseNumber(n.target.value) : t.includes("boolean") ? r = safeParseBoolean(n.target.value) : r = n.target.value, n.target.checked ? i.includes(r) ? i : i.concat([r]) : i.filter((a) => !checkedAttrLooseCompare2(a, r));
      } else
        return n.target.checked;
    else {
      if (e.tagName.toLowerCase() === "select" && e.multiple)
        return t.includes("number") ? Array.from(n.target.selectedOptions).map((r) => {
          let a = r.value || r.text;
          return safeParseNumber(a);
        }) : t.includes("boolean") ? Array.from(n.target.selectedOptions).map((r) => {
          let a = r.value || r.text;
          return safeParseBoolean(a);
        }) : Array.from(n.target.selectedOptions).map((r) => r.value || r.text);
      {
        let r;
        return isRadio(e) ? n.target.checked ? r = n.target.value : r = i : r = n.target.value, t.includes("number") ? safeParseNumber(r) : t.includes("boolean") ? safeParseBoolean(r) : t.includes("trim") ? r.trim() : r;
      }
    }
  });
}
function safeParseNumber(e) {
  let t = e ? parseFloat(e) : null;
  return isNumeric2(t) ? t : e;
}
function checkedAttrLooseCompare2(e, t) {
  return e == t;
}
function isNumeric2(e) {
  return !Array.isArray(e) && !isNaN(e);
}
function isGetterSetter(e) {
  return e !== null && typeof e == "object" && typeof e.get == "function" && typeof e.set == "function";
}
directive("cloak", (e) => queueMicrotask(() => mutateDom(() => e.removeAttribute(prefix("cloak")))));
addInitSelector(() => `[${prefix("init")}]`);
directive("init", skipDuringClone((e, { expression: t }, { evaluate: n }) => typeof t == "string" ? !!t.trim() && n(t, {}, !1) : n(t, {}, !1)));
directive("text", (e, { expression: t }, { effect: n, evaluateLater: i }) => {
  let r = i(t);
  n(() => {
    r((a) => {
      mutateDom(() => {
        e.textContent = a;
      });
    });
  });
});
directive("html", (e, { expression: t }, { effect: n, evaluateLater: i }) => {
  let r = i(t);
  n(() => {
    r((a) => {
      mutateDom(() => {
        e.innerHTML = a, e._x_ignoreSelf = !0, initTree(e), delete e._x_ignoreSelf;
      });
    });
  });
});
mapAttributes(startingWith(":", into(prefix("bind:"))));
var handler2 = (e, { value: t, modifiers: n, expression: i, original: r }, { effect: a, cleanup: s }) => {
  if (!t) {
    let l = {};
    injectBindingProviders(l), evaluateLater(e, i)((u) => {
      applyBindingsObject(e, u, r);
    }, { scope: l });
    return;
  }
  if (t === "key")
    return storeKeyForXFor(e, i);
  if (e._x_inlineBindings && e._x_inlineBindings[t] && e._x_inlineBindings[t].extract)
    return;
  let o = evaluateLater(e, i);
  a(() => o((l) => {
    l === void 0 && typeof i == "string" && i.match(/\./) && (l = ""), mutateDom(() => bind(e, t, l, n));
  })), s(() => {
    e._x_undoAddedClasses && e._x_undoAddedClasses(), e._x_undoAddedStyles && e._x_undoAddedStyles();
  });
};
handler2.inline = (e, { value: t, modifiers: n, expression: i }) => {
  t && (e._x_inlineBindings || (e._x_inlineBindings = {}), e._x_inlineBindings[t] = { expression: i, extract: !1 });
};
directive("bind", handler2);
function storeKeyForXFor(e, t) {
  e._x_keyExpression = t;
}
addRootSelector(() => `[${prefix("data")}]`);
directive("data", (e, { expression: t }, { cleanup: n }) => {
  if (shouldSkipRegisteringDataDuringClone(e))
    return;
  t = t === "" ? "{}" : t;
  let i = {};
  injectMagics(i, e);
  let r = {};
  injectDataProviders(r, i);
  let a = evaluate(e, t, { scope: r });
  (a === void 0 || a === !0) && (a = {}), injectMagics(a, e);
  let s = reactive(a);
  initInterceptors(s);
  let o = addScopeToNode(e, s);
  s.init && evaluate(e, s.init), n(() => {
    s.destroy && evaluate(e, s.destroy), o();
  });
});
interceptClone((e, t) => {
  e._x_dataStack && (t._x_dataStack = e._x_dataStack, t.setAttribute("data-has-alpine-state", !0));
});
function shouldSkipRegisteringDataDuringClone(e) {
  return isCloning ? isCloningLegacy ? !0 : e.hasAttribute("data-has-alpine-state") : !1;
}
directive("show", (e, { modifiers: t, expression: n }, { effect: i }) => {
  let r = evaluateLater(e, n);
  e._x_doHide || (e._x_doHide = () => {
    mutateDom(() => {
      e.style.setProperty("display", "none", t.includes("important") ? "important" : void 0);
    });
  }), e._x_doShow || (e._x_doShow = () => {
    mutateDom(() => {
      e.style.length === 1 && e.style.display === "none" ? e.removeAttribute("style") : e.style.removeProperty("display");
    });
  });
  let a = () => {
    e._x_doHide(), e._x_isShown = !1;
  }, s = () => {
    e._x_doShow(), e._x_isShown = !0;
  }, o = () => setTimeout(s), l = once(
    (d) => d ? s() : a(),
    (d) => {
      typeof e._x_toggleAndCascadeWithTransitions == "function" ? e._x_toggleAndCascadeWithTransitions(e, d, s, a) : d ? o() : a();
    }
  ), c, u = !0;
  i(() => r((d) => {
    !u && d === c || (t.includes("immediate") && (d ? o() : a()), l(d), c = d, u = !1);
  }));
});
directive("for", (e, { expression: t }, { effect: n, cleanup: i }) => {
  let r = parseForExpression(t), a = evaluateLater(e, r.items), s = evaluateLater(
    e,
    // the x-bind:key expression is stored for our use instead of evaluated.
    e._x_keyExpression || "index"
  );
  e._x_prevKeys = [], e._x_lookup = {}, n(() => loop(e, r, a, s)), i(() => {
    Object.values(e._x_lookup).forEach((o) => mutateDom(
      () => {
        destroyTree(o), o.remove();
      }
    )), delete e._x_prevKeys, delete e._x_lookup;
  });
});
function loop(e, t, n, i) {
  let r = (s) => typeof s == "object" && !Array.isArray(s), a = e;
  n((s) => {
    isNumeric3(s) && s >= 0 && (s = Array.from(Array(s).keys(), (m) => m + 1)), s === void 0 && (s = []);
    let o = e._x_lookup, l = e._x_prevKeys, c = [], u = [];
    if (r(s))
      s = Object.entries(s).map(([m, E]) => {
        let g = getIterationScopeVariables(t, E, m, s);
        i((y) => {
          u.includes(y) && warn("Duplicate key on x-for", e), u.push(y);
        }, { scope: { index: m, ...g } }), c.push(g);
      });
    else
      for (let m = 0; m < s.length; m++) {
        let E = getIterationScopeVariables(t, s[m], m, s);
        i((g) => {
          u.includes(g) && warn("Duplicate key on x-for", e), u.push(g);
        }, { scope: { index: m, ...E } }), c.push(E);
      }
    let d = [], h = [], b = [], v = [];
    for (let m = 0; m < l.length; m++) {
      let E = l[m];
      u.indexOf(E) === -1 && b.push(E);
    }
    l = l.filter((m) => !b.includes(m));
    let x = "template";
    for (let m = 0; m < u.length; m++) {
      let E = u[m], g = l.indexOf(E);
      if (g === -1)
        l.splice(m, 0, E), d.push([x, m]);
      else if (g !== m) {
        let y = l.splice(m, 1)[0], f = l.splice(g - 1, 1)[0];
        l.splice(m, 0, f), l.splice(g, 0, y), h.push([y, f]);
      } else
        v.push(E);
      x = E;
    }
    for (let m = 0; m < b.length; m++) {
      let E = b[m];
      E in o && (mutateDom(() => {
        destroyTree(o[E]), o[E].remove();
      }), delete o[E]);
    }
    for (let m = 0; m < h.length; m++) {
      let [E, g] = h[m], y = o[E], f = o[g], p = document.createElement("div");
      mutateDom(() => {
        f || warn('x-for ":key" is undefined or invalid', a, g, o), f.after(p), y.after(f), f._x_currentIfEl && f.after(f._x_currentIfEl), p.before(y), y._x_currentIfEl && y.after(y._x_currentIfEl), p.remove();
      }), f._x_refreshXForScope(c[u.indexOf(g)]);
    }
    for (let m = 0; m < d.length; m++) {
      let [E, g] = d[m], y = E === "template" ? a : o[E];
      y._x_currentIfEl && (y = y._x_currentIfEl);
      let f = c[g], p = u[g], _ = document.importNode(a.content, !0).firstElementChild, w = reactive(f);
      addScopeToNode(_, w, a), _._x_refreshXForScope = (D) => {
        Object.entries(D).forEach(([A, C]) => {
          w[A] = C;
        });
      }, mutateDom(() => {
        y.after(_), skipDuringClone(() => initTree(_))();
      }), typeof p == "object" && warn("x-for key cannot be an object, it must be a string or an integer", a), o[p] = _;
    }
    for (let m = 0; m < v.length; m++)
      o[v[m]]._x_refreshXForScope(c[u.indexOf(v[m])]);
    a._x_prevKeys = u;
  });
}
function parseForExpression(e) {
  let t = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/, n = /^\s*\(|\)\s*$/g, i = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/, r = e.match(i);
  if (!r)
    return;
  let a = {};
  a.items = r[2].trim();
  let s = r[1].replace(n, "").trim(), o = s.match(t);
  return o ? (a.item = s.replace(t, "").trim(), a.index = o[1].trim(), o[2] && (a.collection = o[2].trim())) : a.item = s, a;
}
function getIterationScopeVariables(e, t, n, i) {
  let r = {};
  return /^\[.*\]$/.test(e.item) && Array.isArray(t) ? e.item.replace("[", "").replace("]", "").split(",").map((s) => s.trim()).forEach((s, o) => {
    r[s] = t[o];
  }) : /^\{.*\}$/.test(e.item) && !Array.isArray(t) && typeof t == "object" ? e.item.replace("{", "").replace("}", "").split(",").map((s) => s.trim()).forEach((s) => {
    r[s] = t[s];
  }) : r[e.item] = t, e.index && (r[e.index] = n), e.collection && (r[e.collection] = i), r;
}
function isNumeric3(e) {
  return !Array.isArray(e) && !isNaN(e);
}
function handler3() {
}
handler3.inline = (e, { expression: t }, { cleanup: n }) => {
  let i = closestRoot(e);
  i._x_refs || (i._x_refs = {}), i._x_refs[t] = e, n(() => delete i._x_refs[t]);
};
directive("ref", handler3);
directive("if", (e, { expression: t }, { effect: n, cleanup: i }) => {
  e.tagName.toLowerCase() !== "template" && warn("x-if can only be used on a <template> tag", e);
  let r = evaluateLater(e, t), a = () => {
    if (e._x_currentIfEl)
      return e._x_currentIfEl;
    let o = e.content.cloneNode(!0).firstElementChild;
    return addScopeToNode(o, {}, e), mutateDom(() => {
      e.after(o), skipDuringClone(() => initTree(o))();
    }), e._x_currentIfEl = o, e._x_undoIf = () => {
      mutateDom(() => {
        destroyTree(o), o.remove();
      }), delete e._x_currentIfEl;
    }, o;
  }, s = () => {
    e._x_undoIf && (e._x_undoIf(), delete e._x_undoIf);
  };
  n(() => r((o) => {
    o ? a() : s();
  })), i(() => e._x_undoIf && e._x_undoIf());
});
directive("id", (e, { expression: t }, { evaluate: n }) => {
  n(t).forEach((r) => setIdRoot(e, r));
});
interceptClone((e, t) => {
  e._x_ids && (t._x_ids = e._x_ids);
});
mapAttributes(startingWith("@", into(prefix("on:"))));
directive("on", skipDuringClone((e, { value: t, modifiers: n, expression: i }, { cleanup: r }) => {
  let a = i ? evaluateLater(e, i) : () => {
  };
  e.tagName.toLowerCase() === "template" && (e._x_forwardEvents || (e._x_forwardEvents = []), e._x_forwardEvents.includes(t) || e._x_forwardEvents.push(t));
  let s = on(e, t, n, (o) => {
    a(() => {
    }, { scope: { $event: o }, params: [o] });
  });
  r(() => s());
}));
warnMissingPluginDirective("Collapse", "collapse", "collapse");
warnMissingPluginDirective("Intersect", "intersect", "intersect");
warnMissingPluginDirective("Focus", "trap", "focus");
warnMissingPluginDirective("Mask", "mask", "mask");
function warnMissingPluginDirective(e, t, n) {
  directive(t, (i) => warn(`You can't use [x-${t}] without first installing the "${e}" plugin here: https://alpinejs.dev/plugins/${n}`, i));
}
alpine_default.setEvaluator(normalEvaluator);
alpine_default.setReactivityEngine({ reactive: reactive2, effect: effect2, release: stop, raw: toRaw });
var src_default = alpine_default, module_default = src_default, Events = (
  /** @class */
  (function() {
    function e(t, n) {
      n === void 0 && (n = []), this._eventType = t, this._eventFunctions = n;
    }
    return e.prototype.init = function() {
      var t = this;
      this._eventFunctions.forEach(function(n) {
        typeof window < "u" && window.addEventListener(t._eventType, n);
      });
    }, e;
  })()
), Instances = (
  /** @class */
  (function() {
    function e() {
      this._instances = {
        Accordion: {},
        Carousel: {},
        Collapse: {},
        Dial: {},
        Dismiss: {},
        Drawer: {},
        Dropdown: {},
        Modal: {},
        Popover: {},
        Tabs: {},
        Tooltip: {},
        InputCounter: {},
        CopyClipboard: {},
        Datepicker: {}
      };
    }
    return e.prototype.addInstance = function(t, n, i, r) {
      if (r === void 0 && (r = !1), !this._instances[t])
        return console.warn("Flowbite: Component ".concat(t, " does not exist.")), !1;
      if (this._instances[t][i] && !r) {
        console.warn("Flowbite: Instance with ID ".concat(i, " already exists."));
        return;
      }
      r && this._instances[t][i] && this._instances[t][i].destroyAndRemoveInstance(), this._instances[t][i || this._generateRandomId()] = n;
    }, e.prototype.getAllInstances = function() {
      return this._instances;
    }, e.prototype.getInstances = function(t) {
      return this._instances[t] ? this._instances[t] : (console.warn("Flowbite: Component ".concat(t, " does not exist.")), !1);
    }, e.prototype.getInstance = function(t, n) {
      if (this._componentAndInstanceCheck(t, n)) {
        if (!this._instances[t][n]) {
          console.warn("Flowbite: Instance with ID ".concat(n, " does not exist."));
          return;
        }
        return this._instances[t][n];
      }
    }, e.prototype.destroyAndRemoveInstance = function(t, n) {
      this._componentAndInstanceCheck(t, n) && (this.destroyInstanceObject(t, n), this.removeInstance(t, n));
    }, e.prototype.removeInstance = function(t, n) {
      this._componentAndInstanceCheck(t, n) && delete this._instances[t][n];
    }, e.prototype.destroyInstanceObject = function(t, n) {
      this._componentAndInstanceCheck(t, n) && this._instances[t][n].destroy();
    }, e.prototype.instanceExists = function(t, n) {
      return !(!this._instances[t] || !this._instances[t][n]);
    }, e.prototype._generateRandomId = function() {
      return Math.random().toString(36).substr(2, 9);
    }, e.prototype._componentAndInstanceCheck = function(t, n) {
      return this._instances[t] ? this._instances[t][n] ? !0 : (console.warn("Flowbite: Instance with ID ".concat(n, " does not exist.")), !1) : (console.warn("Flowbite: Component ".concat(t, " does not exist.")), !1);
    }, e;
  })()
), instances = new Instances();
typeof window < "u" && (window.FlowbiteInstances = instances);
var __assign$d = function() {
  return __assign$d = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign$d.apply(this, arguments);
}, Default$d = {
  alwaysOpen: !1,
  activeClasses: "bg-neutral-secondary-medium text-heading",
  inactiveClasses: "bg-neutral-primary text-body",
  onOpen: function() {
  },
  onClose: function() {
  },
  onToggle: function() {
  }
}, DefaultInstanceOptions$d = {
  id: null,
  override: !0
}, Accordion = (
  /** @class */
  (function() {
    function e(t, n, i, r) {
      t === void 0 && (t = null), n === void 0 && (n = []), i === void 0 && (i = Default$d), r === void 0 && (r = DefaultInstanceOptions$d), this._instanceId = r.id ? r.id : t.id, this._accordionEl = t, this._items = n, this._options = __assign$d(__assign$d({}, Default$d), i), this._initialized = !1, this.init(), instances.addInstance("Accordion", this, this._instanceId, r.override);
    }
    return e.prototype.init = function() {
      var t = this;
      this._items.length && !this._initialized && (this._items.forEach(function(n) {
        n.active && t.open(n.id);
        var i = function() {
          t.toggle(n.id);
        };
        n.triggerEl.addEventListener("click", i), n.clickHandler = i;
      }), this._initialized = !0);
    }, e.prototype.destroy = function() {
      this._items.length && this._initialized && (this._items.forEach(function(t) {
        t.triggerEl.removeEventListener("click", t.clickHandler), delete t.clickHandler;
      }), this._initialized = !1);
    }, e.prototype.removeInstance = function() {
      instances.removeInstance("Accordion", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype.getItem = function(t) {
      return this._items.filter(function(n) {
        return n.id === t;
      })[0];
    }, e.prototype.open = function(t) {
      var n, i, r = this, a = this.getItem(t);
      this._options.alwaysOpen || this._items.map(function(s) {
        var o, l;
        s !== a && ((o = s.triggerEl.classList).remove.apply(o, r._options.activeClasses.split(" ")), (l = s.triggerEl.classList).add.apply(l, r._options.inactiveClasses.split(" ")), s.targetEl.classList.add("hidden"), s.triggerEl.setAttribute("aria-expanded", "false"), s.active = !1, s.iconEl && s.iconEl.classList.add("rotate-180"));
      }), (n = a.triggerEl.classList).add.apply(n, this._options.activeClasses.split(" ")), (i = a.triggerEl.classList).remove.apply(i, this._options.inactiveClasses.split(" ")), a.triggerEl.setAttribute("aria-expanded", "true"), a.targetEl.classList.remove("hidden"), a.active = !0, a.iconEl && a.iconEl.classList.remove("rotate-180"), this._options.onOpen(this, a);
    }, e.prototype.toggle = function(t) {
      var n = this.getItem(t);
      n.active ? this.close(t) : this.open(t), this._options.onToggle(this, n);
    }, e.prototype.close = function(t) {
      var n, i, r = this.getItem(t);
      (n = r.triggerEl.classList).remove.apply(n, this._options.activeClasses.split(" ")), (i = r.triggerEl.classList).add.apply(i, this._options.inactiveClasses.split(" ")), r.targetEl.classList.add("hidden"), r.triggerEl.setAttribute("aria-expanded", "false"), r.active = !1, r.iconEl && r.iconEl.classList.add("rotate-180"), this._options.onClose(this, r);
    }, e.prototype.updateOnOpen = function(t) {
      this._options.onOpen = t;
    }, e.prototype.updateOnClose = function(t) {
      this._options.onClose = t;
    }, e.prototype.updateOnToggle = function(t) {
      this._options.onToggle = t;
    }, e;
  })()
);
function initAccordions() {
  document.querySelectorAll("[data-accordion]").forEach(function(e) {
    var t = e.getAttribute("data-accordion"), n = e.getAttribute("data-active-classes"), i = e.getAttribute("data-inactive-classes"), r = [];
    e.querySelectorAll("[data-accordion-target]").forEach(function(a) {
      if (a.closest("[data-accordion]") === e) {
        var s = {
          id: a.getAttribute("data-accordion-target"),
          triggerEl: a,
          targetEl: document.querySelector(a.getAttribute("data-accordion-target")),
          iconEl: a.querySelector("[data-accordion-icon]"),
          active: a.getAttribute("aria-expanded") === "true"
        };
        r.push(s);
      }
    }), new Accordion(e, r, {
      alwaysOpen: t === "open",
      activeClasses: n || Default$d.activeClasses,
      inactiveClasses: i || Default$d.inactiveClasses
    });
  });
}
typeof window < "u" && (window.Accordion = Accordion, window.initAccordions = initAccordions);
var __assign$c = function() {
  return __assign$c = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign$c.apply(this, arguments);
}, Default$c = {
  onCollapse: function() {
  },
  onExpand: function() {
  },
  onToggle: function() {
  }
}, DefaultInstanceOptions$c = {
  id: null,
  override: !0
}, Collapse = (
  /** @class */
  (function() {
    function e(t, n, i, r) {
      t === void 0 && (t = null), n === void 0 && (n = null), i === void 0 && (i = Default$c), r === void 0 && (r = DefaultInstanceOptions$c), this._instanceId = r.id ? r.id : t.id, this._targetEl = t, this._triggerEl = n, this._options = __assign$c(__assign$c({}, Default$c), i), this._visible = !1, this._initialized = !1, this.init(), instances.addInstance("Collapse", this, this._instanceId, r.override);
    }
    return e.prototype.init = function() {
      var t = this;
      this._triggerEl && this._targetEl && !this._initialized && (this._triggerEl.hasAttribute("aria-expanded") ? this._visible = this._triggerEl.getAttribute("aria-expanded") === "true" : this._visible = !this._targetEl.classList.contains("hidden"), this._clickHandler = function() {
        t.toggle();
      }, this._triggerEl.addEventListener("click", this._clickHandler), this._initialized = !0);
    }, e.prototype.destroy = function() {
      this._triggerEl && this._initialized && (this._triggerEl.removeEventListener("click", this._clickHandler), this._initialized = !1);
    }, e.prototype.removeInstance = function() {
      instances.removeInstance("Collapse", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype.collapse = function() {
      this._targetEl.classList.add("hidden"), this._triggerEl && this._triggerEl.setAttribute("aria-expanded", "false"), this._visible = !1, this._options.onCollapse(this);
    }, e.prototype.expand = function() {
      this._targetEl.classList.remove("hidden"), this._triggerEl && this._triggerEl.setAttribute("aria-expanded", "true"), this._visible = !0, this._options.onExpand(this);
    }, e.prototype.toggle = function() {
      this._visible ? this.collapse() : this.expand(), this._options.onToggle(this);
    }, e.prototype.updateOnCollapse = function(t) {
      this._options.onCollapse = t;
    }, e.prototype.updateOnExpand = function(t) {
      this._options.onExpand = t;
    }, e.prototype.updateOnToggle = function(t) {
      this._options.onToggle = t;
    }, e;
  })()
);
function initCollapses() {
  document.querySelectorAll("[data-collapse-toggle]").forEach(function(e) {
    var t = e.getAttribute("data-collapse-toggle"), n = document.getElementById(t);
    n ? instances.instanceExists("Collapse", n.getAttribute("id")) ? new Collapse(n, e, {}, {
      id: n.getAttribute("id") + "_" + instances._generateRandomId()
    }) : new Collapse(n, e) : console.error('The target element with id "'.concat(t, '" does not exist. Please check the data-collapse-toggle attribute.'));
  });
}
typeof window < "u" && (window.Collapse = Collapse, window.initCollapses = initCollapses);
var __assign$b = function() {
  return __assign$b = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign$b.apply(this, arguments);
}, Default$b = {
  defaultPosition: 0,
  indicators: {
    items: [],
    activeClasses: "bg-white dark:bg-gray-800",
    inactiveClasses: "bg-white/50 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-800"
  },
  interval: 3e3,
  onNext: function() {
  },
  onPrev: function() {
  },
  onChange: function() {
  }
}, DefaultInstanceOptions$b = {
  id: null,
  override: !0
}, Carousel = (
  /** @class */
  (function() {
    function e(t, n, i, r) {
      t === void 0 && (t = null), n === void 0 && (n = []), i === void 0 && (i = Default$b), r === void 0 && (r = DefaultInstanceOptions$b), this._instanceId = r.id ? r.id : t.id, this._carouselEl = t, this._items = n, this._options = __assign$b(__assign$b(__assign$b({}, Default$b), i), { indicators: __assign$b(__assign$b({}, Default$b.indicators), i.indicators) }), this._activeItem = this.getItem(this._options.defaultPosition), this._indicators = this._options.indicators.items, this._intervalDuration = this._options.interval, this._intervalInstance = null, this._initialized = !1, this.init(), instances.addInstance("Carousel", this, this._instanceId, r.override);
    }
    return e.prototype.init = function() {
      var t = this;
      this._items.length && !this._initialized && (this._items.map(function(n) {
        n.el.classList.add("absolute", "inset-0", "transition-transform", "transform");
      }), this.getActiveItem() ? this.slideTo(this.getActiveItem().position) : this.slideTo(0), this._indicators.map(function(n, i) {
        n.el.addEventListener("click", function() {
          t.slideTo(i);
        });
      }), this._initialized = !0);
    }, e.prototype.destroy = function() {
      this._initialized && (this._initialized = !1);
    }, e.prototype.removeInstance = function() {
      instances.removeInstance("Carousel", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype.getItem = function(t) {
      return this._items[t];
    }, e.prototype.slideTo = function(t) {
      var n = this._items[t], i = {
        left: n.position === 0 ? this._items[this._items.length - 1] : this._items[n.position - 1],
        middle: n,
        right: n.position === this._items.length - 1 ? this._items[0] : this._items[n.position + 1]
      };
      this._rotate(i), this._setActiveItem(n), this._intervalInstance && (this.pause(), this.cycle()), this._options.onChange(this);
    }, e.prototype.next = function() {
      var t = this.getActiveItem(), n = null;
      t.position === this._items.length - 1 ? n = this._items[0] : n = this._items[t.position + 1], this.slideTo(n.position), this._options.onNext(this);
    }, e.prototype.prev = function() {
      var t = this.getActiveItem(), n = null;
      t.position === 0 ? n = this._items[this._items.length - 1] : n = this._items[t.position - 1], this.slideTo(n.position), this._options.onPrev(this);
    }, e.prototype._rotate = function(t) {
      if (this._items.map(function(n) {
        n.el.classList.add("hidden");
      }), this._items.length === 1) {
        t.middle.el.classList.remove("-translate-x-full", "translate-x-full", "translate-x-0", "hidden", "z-10"), t.middle.el.classList.add("translate-x-0", "z-20");
        return;
      }
      t.left.el.classList.remove("-translate-x-full", "translate-x-full", "translate-x-0", "hidden", "z-20"), t.left.el.classList.add("-translate-x-full", "z-10"), t.middle.el.classList.remove("-translate-x-full", "translate-x-full", "translate-x-0", "hidden", "z-10"), t.middle.el.classList.add("translate-x-0", "z-30"), t.right.el.classList.remove("-translate-x-full", "translate-x-full", "translate-x-0", "hidden", "z-30"), t.right.el.classList.add("translate-x-full", "z-20");
    }, e.prototype.cycle = function() {
      var t = this;
      typeof window < "u" && (this._intervalInstance = window.setInterval(function() {
        t.next();
      }, this._intervalDuration));
    }, e.prototype.pause = function() {
      clearInterval(this._intervalInstance);
    }, e.prototype.getActiveItem = function() {
      return this._activeItem;
    }, e.prototype._setActiveItem = function(t) {
      var n, i, r = this;
      this._activeItem = t;
      var a = t.position;
      this._indicators.length && (this._indicators.map(function(s) {
        var o, l;
        s.el.setAttribute("aria-current", "false"), (o = s.el.classList).remove.apply(o, r._options.indicators.activeClasses.split(" ")), (l = s.el.classList).add.apply(l, r._options.indicators.inactiveClasses.split(" "));
      }), (n = this._indicators[a].el.classList).add.apply(n, this._options.indicators.activeClasses.split(" ")), (i = this._indicators[a].el.classList).remove.apply(i, this._options.indicators.inactiveClasses.split(" ")), this._indicators[a].el.setAttribute("aria-current", "true"));
    }, e.prototype.updateOnNext = function(t) {
      this._options.onNext = t;
    }, e.prototype.updateOnPrev = function(t) {
      this._options.onPrev = t;
    }, e.prototype.updateOnChange = function(t) {
      this._options.onChange = t;
    }, e;
  })()
);
function initCarousels() {
  document.querySelectorAll("[data-carousel]").forEach(function(e) {
    var t = e.getAttribute("data-carousel-interval"), n = e.getAttribute("data-carousel") === "slide", i = [], r = 0;
    e.querySelectorAll("[data-carousel-item]").length && Array.from(e.querySelectorAll("[data-carousel-item]")).map(function(c, u) {
      i.push({
        position: u,
        el: c
      }), c.getAttribute("data-carousel-item") === "active" && (r = u);
    });
    var a = [];
    e.querySelectorAll("[data-carousel-slide-to]").length && Array.from(e.querySelectorAll("[data-carousel-slide-to]")).map(function(c) {
      a.push({
        position: parseInt(c.getAttribute("data-carousel-slide-to")),
        el: c
      });
    });
    var s = new Carousel(e, i, {
      defaultPosition: r,
      indicators: {
        items: a
      },
      interval: t || Default$b.interval
    });
    n && s.cycle();
    var o = e.querySelector("[data-carousel-next]"), l = e.querySelector("[data-carousel-prev]");
    o && o.addEventListener("click", function() {
      s.next();
    }), l && l.addEventListener("click", function() {
      s.prev();
    });
  });
}
typeof window < "u" && (window.Carousel = Carousel, window.initCarousels = initCarousels);
var __assign$a = function() {
  return __assign$a = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign$a.apply(this, arguments);
}, Default$a = {
  transition: "transition-opacity",
  duration: 300,
  timing: "ease-out",
  onHide: function() {
  }
}, DefaultInstanceOptions$a = {
  id: null,
  override: !0
}, Dismiss = (
  /** @class */
  (function() {
    function e(t, n, i, r) {
      t === void 0 && (t = null), n === void 0 && (n = null), i === void 0 && (i = Default$a), r === void 0 && (r = DefaultInstanceOptions$a), this._instanceId = r.id ? r.id : t.id, this._targetEl = t, this._triggerEl = n, this._options = __assign$a(__assign$a({}, Default$a), i), this._initialized = !1, this.init(), instances.addInstance("Dismiss", this, this._instanceId, r.override);
    }
    return e.prototype.init = function() {
      var t = this;
      this._triggerEl && this._targetEl && !this._initialized && (this._clickHandler = function() {
        t.hide();
      }, this._triggerEl.addEventListener("click", this._clickHandler), this._initialized = !0);
    }, e.prototype.destroy = function() {
      this._triggerEl && this._initialized && (this._triggerEl.removeEventListener("click", this._clickHandler), this._initialized = !1);
    }, e.prototype.removeInstance = function() {
      instances.removeInstance("Dismiss", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype.hide = function() {
      var t = this;
      this._targetEl.classList.add(this._options.transition, "duration-".concat(this._options.duration), this._options.timing, "opacity-0"), setTimeout(function() {
        t._targetEl.classList.add("hidden");
      }, this._options.duration), this._options.onHide(this, this._targetEl);
    }, e.prototype.updateOnHide = function(t) {
      this._options.onHide = t;
    }, e;
  })()
);
function initDismisses() {
  document.querySelectorAll("[data-dismiss-target]").forEach(function(e) {
    var t = e.getAttribute("data-dismiss-target"), n = document.querySelector(t);
    n ? new Dismiss(n, e) : console.error('The dismiss element with id "'.concat(t, '" does not exist. Please check the data-dismiss-target attribute.'));
  });
}
typeof window < "u" && (window.Dismiss = Dismiss, window.initDismisses = initDismisses);
var top = "top", bottom = "bottom", right = "right", left = "left", auto = "auto", basePlacements = [top, bottom, right, left], start = "start", end = "end", clippingParents = "clippingParents", viewport = "viewport", popper = "popper", reference = "reference", variationPlacements = /* @__PURE__ */ basePlacements.reduce(function(e, t) {
  return e.concat([t + "-" + start, t + "-" + end]);
}, []), placements = /* @__PURE__ */ [].concat(basePlacements, [auto]).reduce(function(e, t) {
  return e.concat([t, t + "-" + start, t + "-" + end]);
}, []), beforeRead = "beforeRead", read = "read", afterRead = "afterRead", beforeMain = "beforeMain", main = "main", afterMain = "afterMain", beforeWrite = "beforeWrite", write = "write", afterWrite = "afterWrite", modifierPhases = [beforeRead, read, afterRead, beforeMain, main, afterMain, beforeWrite, write, afterWrite];
function getNodeName(e) {
  return e ? (e.nodeName || "").toLowerCase() : null;
}
function getWindow(e) {
  if (e == null)
    return window;
  if (e.toString() !== "[object Window]") {
    var t = e.ownerDocument;
    return t && t.defaultView || window;
  }
  return e;
}
function isElement(e) {
  var t = getWindow(e).Element;
  return e instanceof t || e instanceof Element;
}
function isHTMLElement(e) {
  var t = getWindow(e).HTMLElement;
  return e instanceof t || e instanceof HTMLElement;
}
function isShadowRoot(e) {
  if (typeof ShadowRoot > "u")
    return !1;
  var t = getWindow(e).ShadowRoot;
  return e instanceof t || e instanceof ShadowRoot;
}
function applyStyles(e) {
  var t = e.state;
  Object.keys(t.elements).forEach(function(n) {
    var i = t.styles[n] || {}, r = t.attributes[n] || {}, a = t.elements[n];
    !isHTMLElement(a) || !getNodeName(a) || (Object.assign(a.style, i), Object.keys(r).forEach(function(s) {
      var o = r[s];
      o === !1 ? a.removeAttribute(s) : a.setAttribute(s, o === !0 ? "" : o);
    }));
  });
}
function effect$2(e) {
  var t = e.state, n = {
    popper: {
      position: t.options.strategy,
      left: "0",
      top: "0",
      margin: "0"
    },
    arrow: {
      position: "absolute"
    },
    reference: {}
  };
  return Object.assign(t.elements.popper.style, n.popper), t.styles = n, t.elements.arrow && Object.assign(t.elements.arrow.style, n.arrow), function() {
    Object.keys(t.elements).forEach(function(i) {
      var r = t.elements[i], a = t.attributes[i] || {}, s = Object.keys(t.styles.hasOwnProperty(i) ? t.styles[i] : n[i]), o = s.reduce(function(l, c) {
        return l[c] = "", l;
      }, {});
      !isHTMLElement(r) || !getNodeName(r) || (Object.assign(r.style, o), Object.keys(a).forEach(function(l) {
        r.removeAttribute(l);
      }));
    });
  };
}
const applyStyles$1 = {
  name: "applyStyles",
  enabled: !0,
  phase: "write",
  fn: applyStyles,
  effect: effect$2,
  requires: ["computeStyles"]
};
function getBasePlacement(e) {
  return e.split("-")[0];
}
var max = Math.max, min = Math.min, round = Math.round;
function getUAString() {
  var e = navigator.userAgentData;
  return e != null && e.brands && Array.isArray(e.brands) ? e.brands.map(function(t) {
    return t.brand + "/" + t.version;
  }).join(" ") : navigator.userAgent;
}
function isLayoutViewport() {
  return !/^((?!chrome|android).)*safari/i.test(getUAString());
}
function getBoundingClientRect(e, t, n) {
  t === void 0 && (t = !1), n === void 0 && (n = !1);
  var i = e.getBoundingClientRect(), r = 1, a = 1;
  t && isHTMLElement(e) && (r = e.offsetWidth > 0 && round(i.width) / e.offsetWidth || 1, a = e.offsetHeight > 0 && round(i.height) / e.offsetHeight || 1);
  var s = isElement(e) ? getWindow(e) : window, o = s.visualViewport, l = !isLayoutViewport() && n, c = (i.left + (l && o ? o.offsetLeft : 0)) / r, u = (i.top + (l && o ? o.offsetTop : 0)) / a, d = i.width / r, h = i.height / a;
  return {
    width: d,
    height: h,
    top: u,
    right: c + d,
    bottom: u + h,
    left: c,
    x: c,
    y: u
  };
}
function getLayoutRect(e) {
  var t = getBoundingClientRect(e), n = e.offsetWidth, i = e.offsetHeight;
  return Math.abs(t.width - n) <= 1 && (n = t.width), Math.abs(t.height - i) <= 1 && (i = t.height), {
    x: e.offsetLeft,
    y: e.offsetTop,
    width: n,
    height: i
  };
}
function contains(e, t) {
  var n = t.getRootNode && t.getRootNode();
  if (e.contains(t))
    return !0;
  if (n && isShadowRoot(n)) {
    var i = t;
    do {
      if (i && e.isSameNode(i))
        return !0;
      i = i.parentNode || i.host;
    } while (i);
  }
  return !1;
}
function getComputedStyle$1(e) {
  return getWindow(e).getComputedStyle(e);
}
function isTableElement(e) {
  return ["table", "td", "th"].indexOf(getNodeName(e)) >= 0;
}
function getDocumentElement(e) {
  return ((isElement(e) ? e.ownerDocument : (
    // $FlowFixMe[prop-missing]
    e.document
  )) || window.document).documentElement;
}
function getParentNode(e) {
  return getNodeName(e) === "html" ? e : (
    // this is a quicker (but less type safe) way to save quite some bytes from the bundle
    // $FlowFixMe[incompatible-return]
    // $FlowFixMe[prop-missing]
    e.assignedSlot || // step into the shadow DOM of the parent of a slotted node
    e.parentNode || // DOM Element detected
    (isShadowRoot(e) ? e.host : null) || // ShadowRoot detected
    // $FlowFixMe[incompatible-call]: HTMLElement is a Node
    getDocumentElement(e)
  );
}
function getTrueOffsetParent(e) {
  return !isHTMLElement(e) || // https://github.com/popperjs/popper-core/issues/837
  getComputedStyle$1(e).position === "fixed" ? null : e.offsetParent;
}
function getContainingBlock(e) {
  var t = /firefox/i.test(getUAString()), n = /Trident/i.test(getUAString());
  if (n && isHTMLElement(e)) {
    var i = getComputedStyle$1(e);
    if (i.position === "fixed")
      return null;
  }
  var r = getParentNode(e);
  for (isShadowRoot(r) && (r = r.host); isHTMLElement(r) && ["html", "body"].indexOf(getNodeName(r)) < 0; ) {
    var a = getComputedStyle$1(r);
    if (a.transform !== "none" || a.perspective !== "none" || a.contain === "paint" || ["transform", "perspective"].indexOf(a.willChange) !== -1 || t && a.willChange === "filter" || t && a.filter && a.filter !== "none")
      return r;
    r = r.parentNode;
  }
  return null;
}
function getOffsetParent(e) {
  for (var t = getWindow(e), n = getTrueOffsetParent(e); n && isTableElement(n) && getComputedStyle$1(n).position === "static"; )
    n = getTrueOffsetParent(n);
  return n && (getNodeName(n) === "html" || getNodeName(n) === "body" && getComputedStyle$1(n).position === "static") ? t : n || getContainingBlock(e) || t;
}
function getMainAxisFromPlacement(e) {
  return ["top", "bottom"].indexOf(e) >= 0 ? "x" : "y";
}
function within(e, t, n) {
  return max(e, min(t, n));
}
function withinMaxClamp(e, t, n) {
  var i = within(e, t, n);
  return i > n ? n : i;
}
function getFreshSideObject() {
  return {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  };
}
function mergePaddingObject(e) {
  return Object.assign({}, getFreshSideObject(), e);
}
function expandToHashMap(e, t) {
  return t.reduce(function(n, i) {
    return n[i] = e, n;
  }, {});
}
var toPaddingObject = function(t, n) {
  return t = typeof t == "function" ? t(Object.assign({}, n.rects, {
    placement: n.placement
  })) : t, mergePaddingObject(typeof t != "number" ? t : expandToHashMap(t, basePlacements));
};
function arrow(e) {
  var t, n = e.state, i = e.name, r = e.options, a = n.elements.arrow, s = n.modifiersData.popperOffsets, o = getBasePlacement(n.placement), l = getMainAxisFromPlacement(o), c = [left, right].indexOf(o) >= 0, u = c ? "height" : "width";
  if (!(!a || !s)) {
    var d = toPaddingObject(r.padding, n), h = getLayoutRect(a), b = l === "y" ? top : left, v = l === "y" ? bottom : right, x = n.rects.reference[u] + n.rects.reference[l] - s[l] - n.rects.popper[u], m = s[l] - n.rects.reference[l], E = getOffsetParent(a), g = E ? l === "y" ? E.clientHeight || 0 : E.clientWidth || 0 : 0, y = x / 2 - m / 2, f = d[b], p = g - h[u] - d[v], _ = g / 2 - h[u] / 2 + y, w = within(f, _, p), D = l;
    n.modifiersData[i] = (t = {}, t[D] = w, t.centerOffset = w - _, t);
  }
}
function effect$1(e) {
  var t = e.state, n = e.options, i = n.element, r = i === void 0 ? "[data-popper-arrow]" : i;
  r != null && (typeof r == "string" && (r = t.elements.popper.querySelector(r), !r) || contains(t.elements.popper, r) && (t.elements.arrow = r));
}
const arrow$1 = {
  name: "arrow",
  enabled: !0,
  phase: "main",
  fn: arrow,
  effect: effect$1,
  requires: ["popperOffsets"],
  requiresIfExists: ["preventOverflow"]
};
function getVariation(e) {
  return e.split("-")[1];
}
var unsetSides = {
  top: "auto",
  right: "auto",
  bottom: "auto",
  left: "auto"
};
function roundOffsetsByDPR(e, t) {
  var n = e.x, i = e.y, r = t.devicePixelRatio || 1;
  return {
    x: round(n * r) / r || 0,
    y: round(i * r) / r || 0
  };
}
function mapToStyles(e) {
  var t, n = e.popper, i = e.popperRect, r = e.placement, a = e.variation, s = e.offsets, o = e.position, l = e.gpuAcceleration, c = e.adaptive, u = e.roundOffsets, d = e.isFixed, h = s.x, b = h === void 0 ? 0 : h, v = s.y, x = v === void 0 ? 0 : v, m = typeof u == "function" ? u({
    x: b,
    y: x
  }) : {
    x: b,
    y: x
  };
  b = m.x, x = m.y;
  var E = s.hasOwnProperty("x"), g = s.hasOwnProperty("y"), y = left, f = top, p = window;
  if (c) {
    var _ = getOffsetParent(n), w = "clientHeight", D = "clientWidth";
    if (_ === getWindow(n) && (_ = getDocumentElement(n), getComputedStyle$1(_).position !== "static" && o === "absolute" && (w = "scrollHeight", D = "scrollWidth")), _ = _, r === top || (r === left || r === right) && a === end) {
      f = bottom;
      var A = d && _ === p && p.visualViewport ? p.visualViewport.height : (
        // $FlowFixMe[prop-missing]
        _[w]
      );
      x -= A - i.height, x *= l ? 1 : -1;
    }
    if (r === left || (r === top || r === bottom) && a === end) {
      y = right;
      var C = d && _ === p && p.visualViewport ? p.visualViewport.width : (
        // $FlowFixMe[prop-missing]
        _[D]
      );
      b -= C - i.width, b *= l ? 1 : -1;
    }
  }
  var S = Object.assign({
    position: o
  }, c && unsetSides), O = u === !0 ? roundOffsetsByDPR({
    x: b,
    y: x
  }, getWindow(n)) : {
    x: b,
    y: x
  };
  if (b = O.x, x = O.y, l) {
    var T;
    return Object.assign({}, S, (T = {}, T[f] = g ? "0" : "", T[y] = E ? "0" : "", T.transform = (p.devicePixelRatio || 1) <= 1 ? "translate(" + b + "px, " + x + "px)" : "translate3d(" + b + "px, " + x + "px, 0)", T));
  }
  return Object.assign({}, S, (t = {}, t[f] = g ? x + "px" : "", t[y] = E ? b + "px" : "", t.transform = "", t));
}
function computeStyles(e) {
  var t = e.state, n = e.options, i = n.gpuAcceleration, r = i === void 0 ? !0 : i, a = n.adaptive, s = a === void 0 ? !0 : a, o = n.roundOffsets, l = o === void 0 ? !0 : o, c = {
    placement: getBasePlacement(t.placement),
    variation: getVariation(t.placement),
    popper: t.elements.popper,
    popperRect: t.rects.popper,
    gpuAcceleration: r,
    isFixed: t.options.strategy === "fixed"
  };
  t.modifiersData.popperOffsets != null && (t.styles.popper = Object.assign({}, t.styles.popper, mapToStyles(Object.assign({}, c, {
    offsets: t.modifiersData.popperOffsets,
    position: t.options.strategy,
    adaptive: s,
    roundOffsets: l
  })))), t.modifiersData.arrow != null && (t.styles.arrow = Object.assign({}, t.styles.arrow, mapToStyles(Object.assign({}, c, {
    offsets: t.modifiersData.arrow,
    position: "absolute",
    adaptive: !1,
    roundOffsets: l
  })))), t.attributes.popper = Object.assign({}, t.attributes.popper, {
    "data-popper-placement": t.placement
  });
}
const computeStyles$1 = {
  name: "computeStyles",
  enabled: !0,
  phase: "beforeWrite",
  fn: computeStyles,
  data: {}
};
var passive = {
  passive: !0
};
function effect(e) {
  var t = e.state, n = e.instance, i = e.options, r = i.scroll, a = r === void 0 ? !0 : r, s = i.resize, o = s === void 0 ? !0 : s, l = getWindow(t.elements.popper), c = [].concat(t.scrollParents.reference, t.scrollParents.popper);
  return a && c.forEach(function(u) {
    u.addEventListener("scroll", n.update, passive);
  }), o && l.addEventListener("resize", n.update, passive), function() {
    a && c.forEach(function(u) {
      u.removeEventListener("scroll", n.update, passive);
    }), o && l.removeEventListener("resize", n.update, passive);
  };
}
const eventListeners = {
  name: "eventListeners",
  enabled: !0,
  phase: "write",
  fn: function() {
  },
  effect,
  data: {}
};
var hash$1 = {
  left: "right",
  right: "left",
  bottom: "top",
  top: "bottom"
};
function getOppositePlacement(e) {
  return e.replace(/left|right|bottom|top/g, function(t) {
    return hash$1[t];
  });
}
var hash = {
  start: "end",
  end: "start"
};
function getOppositeVariationPlacement(e) {
  return e.replace(/start|end/g, function(t) {
    return hash[t];
  });
}
function getWindowScroll(e) {
  var t = getWindow(e), n = t.pageXOffset, i = t.pageYOffset;
  return {
    scrollLeft: n,
    scrollTop: i
  };
}
function getWindowScrollBarX(e) {
  return getBoundingClientRect(getDocumentElement(e)).left + getWindowScroll(e).scrollLeft;
}
function getViewportRect(e, t) {
  var n = getWindow(e), i = getDocumentElement(e), r = n.visualViewport, a = i.clientWidth, s = i.clientHeight, o = 0, l = 0;
  if (r) {
    a = r.width, s = r.height;
    var c = isLayoutViewport();
    (c || !c && t === "fixed") && (o = r.offsetLeft, l = r.offsetTop);
  }
  return {
    width: a,
    height: s,
    x: o + getWindowScrollBarX(e),
    y: l
  };
}
function getDocumentRect(e) {
  var t, n = getDocumentElement(e), i = getWindowScroll(e), r = (t = e.ownerDocument) == null ? void 0 : t.body, a = max(n.scrollWidth, n.clientWidth, r ? r.scrollWidth : 0, r ? r.clientWidth : 0), s = max(n.scrollHeight, n.clientHeight, r ? r.scrollHeight : 0, r ? r.clientHeight : 0), o = -i.scrollLeft + getWindowScrollBarX(e), l = -i.scrollTop;
  return getComputedStyle$1(r || n).direction === "rtl" && (o += max(n.clientWidth, r ? r.clientWidth : 0) - a), {
    width: a,
    height: s,
    x: o,
    y: l
  };
}
function isScrollParent(e) {
  var t = getComputedStyle$1(e), n = t.overflow, i = t.overflowX, r = t.overflowY;
  return /auto|scroll|overlay|hidden/.test(n + r + i);
}
function getScrollParent(e) {
  return ["html", "body", "#document"].indexOf(getNodeName(e)) >= 0 ? e.ownerDocument.body : isHTMLElement(e) && isScrollParent(e) ? e : getScrollParent(getParentNode(e));
}
function listScrollParents(e, t) {
  var n;
  t === void 0 && (t = []);
  var i = getScrollParent(e), r = i === ((n = e.ownerDocument) == null ? void 0 : n.body), a = getWindow(i), s = r ? [a].concat(a.visualViewport || [], isScrollParent(i) ? i : []) : i, o = t.concat(s);
  return r ? o : (
    // $FlowFixMe[incompatible-call]: isBody tells us target will be an HTMLElement here
    o.concat(listScrollParents(getParentNode(s)))
  );
}
function rectToClientRect(e) {
  return Object.assign({}, e, {
    left: e.x,
    top: e.y,
    right: e.x + e.width,
    bottom: e.y + e.height
  });
}
function getInnerBoundingClientRect(e, t) {
  var n = getBoundingClientRect(e, !1, t === "fixed");
  return n.top = n.top + e.clientTop, n.left = n.left + e.clientLeft, n.bottom = n.top + e.clientHeight, n.right = n.left + e.clientWidth, n.width = e.clientWidth, n.height = e.clientHeight, n.x = n.left, n.y = n.top, n;
}
function getClientRectFromMixedType(e, t, n) {
  return t === viewport ? rectToClientRect(getViewportRect(e, n)) : isElement(t) ? getInnerBoundingClientRect(t, n) : rectToClientRect(getDocumentRect(getDocumentElement(e)));
}
function getClippingParents(e) {
  var t = listScrollParents(getParentNode(e)), n = ["absolute", "fixed"].indexOf(getComputedStyle$1(e).position) >= 0, i = n && isHTMLElement(e) ? getOffsetParent(e) : e;
  return isElement(i) ? t.filter(function(r) {
    return isElement(r) && contains(r, i) && getNodeName(r) !== "body";
  }) : [];
}
function getClippingRect(e, t, n, i) {
  var r = t === "clippingParents" ? getClippingParents(e) : [].concat(t), a = [].concat(r, [n]), s = a[0], o = a.reduce(function(l, c) {
    var u = getClientRectFromMixedType(e, c, i);
    return l.top = max(u.top, l.top), l.right = min(u.right, l.right), l.bottom = min(u.bottom, l.bottom), l.left = max(u.left, l.left), l;
  }, getClientRectFromMixedType(e, s, i));
  return o.width = o.right - o.left, o.height = o.bottom - o.top, o.x = o.left, o.y = o.top, o;
}
function computeOffsets(e) {
  var t = e.reference, n = e.element, i = e.placement, r = i ? getBasePlacement(i) : null, a = i ? getVariation(i) : null, s = t.x + t.width / 2 - n.width / 2, o = t.y + t.height / 2 - n.height / 2, l;
  switch (r) {
    case top:
      l = {
        x: s,
        y: t.y - n.height
      };
      break;
    case bottom:
      l = {
        x: s,
        y: t.y + t.height
      };
      break;
    case right:
      l = {
        x: t.x + t.width,
        y: o
      };
      break;
    case left:
      l = {
        x: t.x - n.width,
        y: o
      };
      break;
    default:
      l = {
        x: t.x,
        y: t.y
      };
  }
  var c = r ? getMainAxisFromPlacement(r) : null;
  if (c != null) {
    var u = c === "y" ? "height" : "width";
    switch (a) {
      case start:
        l[c] = l[c] - (t[u] / 2 - n[u] / 2);
        break;
      case end:
        l[c] = l[c] + (t[u] / 2 - n[u] / 2);
        break;
    }
  }
  return l;
}
function detectOverflow(e, t) {
  t === void 0 && (t = {});
  var n = t, i = n.placement, r = i === void 0 ? e.placement : i, a = n.strategy, s = a === void 0 ? e.strategy : a, o = n.boundary, l = o === void 0 ? clippingParents : o, c = n.rootBoundary, u = c === void 0 ? viewport : c, d = n.elementContext, h = d === void 0 ? popper : d, b = n.altBoundary, v = b === void 0 ? !1 : b, x = n.padding, m = x === void 0 ? 0 : x, E = mergePaddingObject(typeof m != "number" ? m : expandToHashMap(m, basePlacements)), g = h === popper ? reference : popper, y = e.rects.popper, f = e.elements[v ? g : h], p = getClippingRect(isElement(f) ? f : f.contextElement || getDocumentElement(e.elements.popper), l, u, s), _ = getBoundingClientRect(e.elements.reference), w = computeOffsets({
    reference: _,
    element: y,
    placement: r
  }), D = rectToClientRect(Object.assign({}, y, w)), A = h === popper ? D : _, C = {
    top: p.top - A.top + E.top,
    bottom: A.bottom - p.bottom + E.bottom,
    left: p.left - A.left + E.left,
    right: A.right - p.right + E.right
  }, S = e.modifiersData.offset;
  if (h === popper && S) {
    var O = S[r];
    Object.keys(C).forEach(function(T) {
      var L = [right, bottom].indexOf(T) >= 0 ? 1 : -1, R = [top, bottom].indexOf(T) >= 0 ? "y" : "x";
      C[T] += O[R] * L;
    });
  }
  return C;
}
function computeAutoPlacement(e, t) {
  t === void 0 && (t = {});
  var n = t, i = n.placement, r = n.boundary, a = n.rootBoundary, s = n.padding, o = n.flipVariations, l = n.allowedAutoPlacements, c = l === void 0 ? placements : l, u = getVariation(i), d = u ? o ? variationPlacements : variationPlacements.filter(function(v) {
    return getVariation(v) === u;
  }) : basePlacements, h = d.filter(function(v) {
    return c.indexOf(v) >= 0;
  });
  h.length === 0 && (h = d);
  var b = h.reduce(function(v, x) {
    return v[x] = detectOverflow(e, {
      placement: x,
      boundary: r,
      rootBoundary: a,
      padding: s
    })[getBasePlacement(x)], v;
  }, {});
  return Object.keys(b).sort(function(v, x) {
    return b[v] - b[x];
  });
}
function getExpandedFallbackPlacements(e) {
  if (getBasePlacement(e) === auto)
    return [];
  var t = getOppositePlacement(e);
  return [getOppositeVariationPlacement(e), t, getOppositeVariationPlacement(t)];
}
function flip(e) {
  var t = e.state, n = e.options, i = e.name;
  if (!t.modifiersData[i]._skip) {
    for (var r = n.mainAxis, a = r === void 0 ? !0 : r, s = n.altAxis, o = s === void 0 ? !0 : s, l = n.fallbackPlacements, c = n.padding, u = n.boundary, d = n.rootBoundary, h = n.altBoundary, b = n.flipVariations, v = b === void 0 ? !0 : b, x = n.allowedAutoPlacements, m = t.options.placement, E = getBasePlacement(m), g = E === m, y = l || (g || !v ? [getOppositePlacement(m)] : getExpandedFallbackPlacements(m)), f = [m].concat(y).reduce(function(V, B) {
      return V.concat(getBasePlacement(B) === auto ? computeAutoPlacement(t, {
        placement: B,
        boundary: u,
        rootBoundary: d,
        padding: c,
        flipVariations: v,
        allowedAutoPlacements: x
      }) : B);
    }, []), p = t.rects.reference, _ = t.rects.popper, w = /* @__PURE__ */ new Map(), D = !0, A = f[0], C = 0; C < f.length; C++) {
      var S = f[C], O = getBasePlacement(S), T = getVariation(S) === start, L = [top, bottom].indexOf(O) >= 0, R = L ? "width" : "height", H = detectOverflow(t, {
        placement: S,
        boundary: u,
        rootBoundary: d,
        altBoundary: h,
        padding: c
      }), I = L ? T ? right : left : T ? bottom : top;
      p[R] > _[R] && (I = getOppositePlacement(I));
      var W = getOppositePlacement(I), $ = [];
      if (a && $.push(H[O] <= 0), o && $.push(H[I] <= 0, H[W] <= 0), $.every(function(V) {
        return V;
      })) {
        A = S, D = !1;
        break;
      }
      w.set(S, $);
    }
    if (D)
      for (var q = v ? 3 : 1, N = function(B) {
        var k = f.find(function(M) {
          var F = w.get(M);
          if (F)
            return F.slice(0, B).every(function(K) {
              return K;
            });
        });
        if (k)
          return A = k, "break";
      }, P = q; P > 0; P--) {
        var j = N(P);
        if (j === "break") break;
      }
    t.placement !== A && (t.modifiersData[i]._skip = !0, t.placement = A, t.reset = !0);
  }
}
const flip$1 = {
  name: "flip",
  enabled: !0,
  phase: "main",
  fn: flip,
  requiresIfExists: ["offset"],
  data: {
    _skip: !1
  }
};
function getSideOffsets(e, t, n) {
  return n === void 0 && (n = {
    x: 0,
    y: 0
  }), {
    top: e.top - t.height - n.y,
    right: e.right - t.width + n.x,
    bottom: e.bottom - t.height + n.y,
    left: e.left - t.width - n.x
  };
}
function isAnySideFullyClipped(e) {
  return [top, right, bottom, left].some(function(t) {
    return e[t] >= 0;
  });
}
function hide(e) {
  var t = e.state, n = e.name, i = t.rects.reference, r = t.rects.popper, a = t.modifiersData.preventOverflow, s = detectOverflow(t, {
    elementContext: "reference"
  }), o = detectOverflow(t, {
    altBoundary: !0
  }), l = getSideOffsets(s, i), c = getSideOffsets(o, r, a), u = isAnySideFullyClipped(l), d = isAnySideFullyClipped(c);
  t.modifiersData[n] = {
    referenceClippingOffsets: l,
    popperEscapeOffsets: c,
    isReferenceHidden: u,
    hasPopperEscaped: d
  }, t.attributes.popper = Object.assign({}, t.attributes.popper, {
    "data-popper-reference-hidden": u,
    "data-popper-escaped": d
  });
}
const hide$1 = {
  name: "hide",
  enabled: !0,
  phase: "main",
  requiresIfExists: ["preventOverflow"],
  fn: hide
};
function distanceAndSkiddingToXY(e, t, n) {
  var i = getBasePlacement(e), r = [left, top].indexOf(i) >= 0 ? -1 : 1, a = typeof n == "function" ? n(Object.assign({}, t, {
    placement: e
  })) : n, s = a[0], o = a[1];
  return s = s || 0, o = (o || 0) * r, [left, right].indexOf(i) >= 0 ? {
    x: o,
    y: s
  } : {
    x: s,
    y: o
  };
}
function offset(e) {
  var t = e.state, n = e.options, i = e.name, r = n.offset, a = r === void 0 ? [0, 0] : r, s = placements.reduce(function(u, d) {
    return u[d] = distanceAndSkiddingToXY(d, t.rects, a), u;
  }, {}), o = s[t.placement], l = o.x, c = o.y;
  t.modifiersData.popperOffsets != null && (t.modifiersData.popperOffsets.x += l, t.modifiersData.popperOffsets.y += c), t.modifiersData[i] = s;
}
const offset$1 = {
  name: "offset",
  enabled: !0,
  phase: "main",
  requires: ["popperOffsets"],
  fn: offset
};
function popperOffsets(e) {
  var t = e.state, n = e.name;
  t.modifiersData[n] = computeOffsets({
    reference: t.rects.reference,
    element: t.rects.popper,
    placement: t.placement
  });
}
const popperOffsets$1 = {
  name: "popperOffsets",
  enabled: !0,
  phase: "read",
  fn: popperOffsets,
  data: {}
};
function getAltAxis(e) {
  return e === "x" ? "y" : "x";
}
function preventOverflow(e) {
  var t = e.state, n = e.options, i = e.name, r = n.mainAxis, a = r === void 0 ? !0 : r, s = n.altAxis, o = s === void 0 ? !1 : s, l = n.boundary, c = n.rootBoundary, u = n.altBoundary, d = n.padding, h = n.tether, b = h === void 0 ? !0 : h, v = n.tetherOffset, x = v === void 0 ? 0 : v, m = detectOverflow(t, {
    boundary: l,
    rootBoundary: c,
    padding: d,
    altBoundary: u
  }), E = getBasePlacement(t.placement), g = getVariation(t.placement), y = !g, f = getMainAxisFromPlacement(E), p = getAltAxis(f), _ = t.modifiersData.popperOffsets, w = t.rects.reference, D = t.rects.popper, A = typeof x == "function" ? x(Object.assign({}, t.rects, {
    placement: t.placement
  })) : x, C = typeof A == "number" ? {
    mainAxis: A,
    altAxis: A
  } : Object.assign({
    mainAxis: 0,
    altAxis: 0
  }, A), S = t.modifiersData.offset ? t.modifiersData.offset[t.placement] : null, O = {
    x: 0,
    y: 0
  };
  if (_) {
    if (a) {
      var T, L = f === "y" ? top : left, R = f === "y" ? bottom : right, H = f === "y" ? "height" : "width", I = _[f], W = I + m[L], $ = I - m[R], q = b ? -D[H] / 2 : 0, N = g === start ? w[H] : D[H], P = g === start ? -D[H] : -w[H], j = t.elements.arrow, V = b && j ? getLayoutRect(j) : {
        width: 0,
        height: 0
      }, B = t.modifiersData["arrow#persistent"] ? t.modifiersData["arrow#persistent"].padding : getFreshSideObject(), k = B[L], M = B[R], F = within(0, w[H], V[H]), K = y ? w[H] / 2 - q - F - k - C.mainAxis : N - F - k - C.mainAxis, ae = y ? -w[H] / 2 + q + F + M + C.mainAxis : P + F + M + C.mainAxis, Y = t.elements.arrow && getOffsetParent(t.elements.arrow), se = Y ? f === "y" ? Y.clientTop || 0 : Y.clientLeft || 0 : 0, J = (T = S?.[f]) != null ? T : 0, oe = I + K - J - se, le = I + ae - J, G = within(b ? min(W, oe) : W, I, b ? max($, le) : $);
      _[f] = G, O[f] = G - I;
    }
    if (o) {
      var Z, ce = f === "x" ? top : left, ue = f === "x" ? bottom : right, z = _[p], U = p === "y" ? "height" : "width", Q = z + m[ce], ee = z - m[ue], X = [top, left].indexOf(E) !== -1, te = (Z = S?.[p]) != null ? Z : 0, ne = X ? Q : z - w[U] - D[U] - te + C.altAxis, ie = X ? z + w[U] + D[U] - te - C.altAxis : ee, re = b && X ? withinMaxClamp(ne, z, ie) : within(b ? ne : Q, z, b ? ie : ee);
      _[p] = re, O[p] = re - z;
    }
    t.modifiersData[i] = O;
  }
}
const preventOverflow$1 = {
  name: "preventOverflow",
  enabled: !0,
  phase: "main",
  fn: preventOverflow,
  requiresIfExists: ["offset"]
};
function getHTMLElementScroll(e) {
  return {
    scrollLeft: e.scrollLeft,
    scrollTop: e.scrollTop
  };
}
function getNodeScroll(e) {
  return e === getWindow(e) || !isHTMLElement(e) ? getWindowScroll(e) : getHTMLElementScroll(e);
}
function isElementScaled(e) {
  var t = e.getBoundingClientRect(), n = round(t.width) / e.offsetWidth || 1, i = round(t.height) / e.offsetHeight || 1;
  return n !== 1 || i !== 1;
}
function getCompositeRect(e, t, n) {
  n === void 0 && (n = !1);
  var i = isHTMLElement(t), r = isHTMLElement(t) && isElementScaled(t), a = getDocumentElement(t), s = getBoundingClientRect(e, r, n), o = {
    scrollLeft: 0,
    scrollTop: 0
  }, l = {
    x: 0,
    y: 0
  };
  return (i || !i && !n) && ((getNodeName(t) !== "body" || // https://github.com/popperjs/popper-core/issues/1078
  isScrollParent(a)) && (o = getNodeScroll(t)), isHTMLElement(t) ? (l = getBoundingClientRect(t, !0), l.x += t.clientLeft, l.y += t.clientTop) : a && (l.x = getWindowScrollBarX(a))), {
    x: s.left + o.scrollLeft - l.x,
    y: s.top + o.scrollTop - l.y,
    width: s.width,
    height: s.height
  };
}
function order(e) {
  var t = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Set(), i = [];
  e.forEach(function(a) {
    t.set(a.name, a);
  });
  function r(a) {
    n.add(a.name);
    var s = [].concat(a.requires || [], a.requiresIfExists || []);
    s.forEach(function(o) {
      if (!n.has(o)) {
        var l = t.get(o);
        l && r(l);
      }
    }), i.push(a);
  }
  return e.forEach(function(a) {
    n.has(a.name) || r(a);
  }), i;
}
function orderModifiers(e) {
  var t = order(e);
  return modifierPhases.reduce(function(n, i) {
    return n.concat(t.filter(function(r) {
      return r.phase === i;
    }));
  }, []);
}
function debounce(e) {
  var t;
  return function() {
    return t || (t = new Promise(function(n) {
      Promise.resolve().then(function() {
        t = void 0, n(e());
      });
    })), t;
  };
}
function mergeByName(e) {
  var t = e.reduce(function(n, i) {
    var r = n[i.name];
    return n[i.name] = r ? Object.assign({}, r, i, {
      options: Object.assign({}, r.options, i.options),
      data: Object.assign({}, r.data, i.data)
    }) : i, n;
  }, {});
  return Object.keys(t).map(function(n) {
    return t[n];
  });
}
var DEFAULT_OPTIONS = {
  placement: "bottom",
  modifiers: [],
  strategy: "absolute"
};
function areValidElements() {
  for (var e = arguments.length, t = new Array(e), n = 0; n < e; n++)
    t[n] = arguments[n];
  return !t.some(function(i) {
    return !(i && typeof i.getBoundingClientRect == "function");
  });
}
function popperGenerator(e) {
  e === void 0 && (e = {});
  var t = e, n = t.defaultModifiers, i = n === void 0 ? [] : n, r = t.defaultOptions, a = r === void 0 ? DEFAULT_OPTIONS : r;
  return function(o, l, c) {
    c === void 0 && (c = a);
    var u = {
      placement: "bottom",
      orderedModifiers: [],
      options: Object.assign({}, DEFAULT_OPTIONS, a),
      modifiersData: {},
      elements: {
        reference: o,
        popper: l
      },
      attributes: {},
      styles: {}
    }, d = [], h = !1, b = {
      state: u,
      setOptions: function(E) {
        var g = typeof E == "function" ? E(u.options) : E;
        x(), u.options = Object.assign({}, a, u.options, g), u.scrollParents = {
          reference: isElement(o) ? listScrollParents(o) : o.contextElement ? listScrollParents(o.contextElement) : [],
          popper: listScrollParents(l)
        };
        var y = orderModifiers(mergeByName([].concat(i, u.options.modifiers)));
        return u.orderedModifiers = y.filter(function(f) {
          return f.enabled;
        }), v(), b.update();
      },
      // Sync update – it will always be executed, even if not necessary. This
      // is useful for low frequency updates where sync behavior simplifies the
      // logic.
      // For high frequency updates (e.g. `resize` and `scroll` events), always
      // prefer the async Popper#update method
      forceUpdate: function() {
        if (!h) {
          var E = u.elements, g = E.reference, y = E.popper;
          if (areValidElements(g, y)) {
            u.rects = {
              reference: getCompositeRect(g, getOffsetParent(y), u.options.strategy === "fixed"),
              popper: getLayoutRect(y)
            }, u.reset = !1, u.placement = u.options.placement, u.orderedModifiers.forEach(function(C) {
              return u.modifiersData[C.name] = Object.assign({}, C.data);
            });
            for (var f = 0; f < u.orderedModifiers.length; f++) {
              if (u.reset === !0) {
                u.reset = !1, f = -1;
                continue;
              }
              var p = u.orderedModifiers[f], _ = p.fn, w = p.options, D = w === void 0 ? {} : w, A = p.name;
              typeof _ == "function" && (u = _({
                state: u,
                options: D,
                name: A,
                instance: b
              }) || u);
            }
          }
        }
      },
      // Async and optimistically optimized update – it will not be executed if
      // not necessary (debounced to run at most once-per-tick)
      update: debounce(function() {
        return new Promise(function(m) {
          b.forceUpdate(), m(u);
        });
      }),
      destroy: function() {
        x(), h = !0;
      }
    };
    if (!areValidElements(o, l))
      return b;
    b.setOptions(c).then(function(m) {
      !h && c.onFirstUpdate && c.onFirstUpdate(m);
    });
    function v() {
      u.orderedModifiers.forEach(function(m) {
        var E = m.name, g = m.options, y = g === void 0 ? {} : g, f = m.effect;
        if (typeof f == "function") {
          var p = f({
            state: u,
            name: E,
            instance: b,
            options: y
          }), _ = function() {
          };
          d.push(p || _);
        }
      });
    }
    function x() {
      d.forEach(function(m) {
        return m();
      }), d = [];
    }
    return b;
  };
}
var defaultModifiers = [eventListeners, popperOffsets$1, computeStyles$1, applyStyles$1, offset$1, flip$1, preventOverflow$1, arrow$1, hide$1], createPopper = /* @__PURE__ */ popperGenerator({
  defaultModifiers
}), __assign$9 = function() {
  return __assign$9 = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign$9.apply(this, arguments);
}, __spreadArray$2 = function(e, t, n) {
  if (n || arguments.length === 2) for (var i = 0, r = t.length, a; i < r; i++)
    (a || !(i in t)) && (a || (a = Array.prototype.slice.call(t, 0, i)), a[i] = t[i]);
  return e.concat(a || Array.prototype.slice.call(t));
}, Default$9 = {
  placement: "bottom",
  triggerType: "click",
  offsetSkidding: 0,
  offsetDistance: 10,
  delay: 300,
  ignoreClickOutsideClass: !1,
  onShow: function() {
  },
  onHide: function() {
  },
  onToggle: function() {
  }
}, DefaultInstanceOptions$9 = {
  id: null,
  override: !0
}, Dropdown = (
  /** @class */
  (function() {
    function e(t, n, i, r) {
      t === void 0 && (t = null), n === void 0 && (n = null), i === void 0 && (i = Default$9), r === void 0 && (r = DefaultInstanceOptions$9), this._instanceId = r.id ? r.id : t.id, this._targetEl = t, this._triggerEl = n, this._options = __assign$9(__assign$9({}, Default$9), i), this._popperInstance = null, this._visible = !1, this._initialized = !1, this.init(), instances.addInstance("Dropdown", this, this._instanceId, r.override);
    }
    return e.prototype.init = function() {
      this._triggerEl && this._targetEl && !this._initialized && (this._popperInstance = this._createPopperInstance(), this._setupEventListeners(), this._initialized = !0);
    }, e.prototype.destroy = function() {
      var t = this, n = this._getTriggerEvents();
      this._options.triggerType === "click" && n.showEvents.forEach(function(i) {
        t._triggerEl.removeEventListener(i, t._clickHandler);
      }), this._options.triggerType === "hover" && (n.showEvents.forEach(function(i) {
        t._triggerEl.removeEventListener(i, t._hoverShowTriggerElHandler), t._targetEl.removeEventListener(i, t._hoverShowTargetElHandler);
      }), n.hideEvents.forEach(function(i) {
        t._triggerEl.removeEventListener(i, t._hoverHideHandler), t._targetEl.removeEventListener(i, t._hoverHideHandler);
      })), this._popperInstance.destroy(), this._initialized = !1;
    }, e.prototype.removeInstance = function() {
      instances.removeInstance("Dropdown", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype._setupEventListeners = function() {
      var t = this, n = this._getTriggerEvents();
      this._clickHandler = function() {
        t.toggle();
      }, this._options.triggerType === "click" && n.showEvents.forEach(function(i) {
        t._triggerEl.addEventListener(i, t._clickHandler);
      }), this._hoverShowTriggerElHandler = function(i) {
        i.type === "click" ? t.toggle() : setTimeout(function() {
          t.show();
        }, t._options.delay);
      }, this._hoverShowTargetElHandler = function() {
        t.show();
      }, this._hoverHideHandler = function() {
        setTimeout(function() {
          t._targetEl.matches(":hover") || t.hide();
        }, t._options.delay);
      }, this._options.triggerType === "hover" && (n.showEvents.forEach(function(i) {
        t._triggerEl.addEventListener(i, t._hoverShowTriggerElHandler), t._targetEl.addEventListener(i, t._hoverShowTargetElHandler);
      }), n.hideEvents.forEach(function(i) {
        t._triggerEl.addEventListener(i, t._hoverHideHandler), t._targetEl.addEventListener(i, t._hoverHideHandler);
      }));
    }, e.prototype._createPopperInstance = function() {
      return createPopper(this._triggerEl, this._targetEl, {
        placement: this._options.placement,
        modifiers: [
          {
            name: "offset",
            options: {
              offset: [
                this._options.offsetSkidding,
                this._options.offsetDistance
              ]
            }
          }
        ]
      });
    }, e.prototype._setupClickOutsideListener = function() {
      var t = this;
      this._clickOutsideEventListener = function(n) {
        t._handleClickOutside(n, t._targetEl);
      }, document.body.addEventListener("click", this._clickOutsideEventListener, !0);
    }, e.prototype._removeClickOutsideListener = function() {
      document.body.removeEventListener("click", this._clickOutsideEventListener, !0);
    }, e.prototype._handleClickOutside = function(t, n) {
      var i = t.target, r = this._options.ignoreClickOutsideClass, a = !1;
      if (r) {
        var s = document.querySelectorAll(".".concat(r));
        s.forEach(function(o) {
          if (o.contains(i)) {
            a = !0;
            return;
          }
        });
      }
      i !== n && !n.contains(i) && !this._triggerEl.contains(i) && !a && this.isVisible() && this.hide();
    }, e.prototype._getTriggerEvents = function() {
      switch (this._options.triggerType) {
        case "hover":
          return {
            showEvents: ["mouseenter", "click"],
            hideEvents: ["mouseleave"]
          };
        case "click":
          return {
            showEvents: ["click"],
            hideEvents: []
          };
        case "none":
          return {
            showEvents: [],
            hideEvents: []
          };
        default:
          return {
            showEvents: ["click"],
            hideEvents: []
          };
      }
    }, e.prototype.toggle = function() {
      this.isVisible() ? this.hide() : this.show(), this._options.onToggle(this);
    }, e.prototype.isVisible = function() {
      return this._visible;
    }, e.prototype.show = function() {
      this._targetEl.classList.remove("hidden"), this._targetEl.classList.add("block"), this._targetEl.removeAttribute("aria-hidden"), this._popperInstance.setOptions(function(t) {
        return __assign$9(__assign$9({}, t), { modifiers: __spreadArray$2(__spreadArray$2([], t.modifiers, !0), [
          { name: "eventListeners", enabled: !0 }
        ], !1) });
      }), this._setupClickOutsideListener(), this._popperInstance.update(), this._visible = !0, this._options.onShow(this);
    }, e.prototype.hide = function() {
      this._targetEl.classList.remove("block"), this._targetEl.classList.add("hidden"), this._targetEl.setAttribute("aria-hidden", "true"), this._popperInstance.setOptions(function(t) {
        return __assign$9(__assign$9({}, t), { modifiers: __spreadArray$2(__spreadArray$2([], t.modifiers, !0), [
          { name: "eventListeners", enabled: !1 }
        ], !1) });
      }), this._visible = !1, this._removeClickOutsideListener(), this._options.onHide(this);
    }, e.prototype.updateOnShow = function(t) {
      this._options.onShow = t;
    }, e.prototype.updateOnHide = function(t) {
      this._options.onHide = t;
    }, e.prototype.updateOnToggle = function(t) {
      this._options.onToggle = t;
    }, e;
  })()
);
function initDropdowns() {
  document.querySelectorAll("[data-dropdown-toggle]").forEach(function(e) {
    var t = e.getAttribute("data-dropdown-toggle"), n = document.getElementById(t);
    if (n) {
      var i = e.getAttribute("data-dropdown-placement"), r = e.getAttribute("data-dropdown-offset-skidding"), a = e.getAttribute("data-dropdown-offset-distance"), s = e.getAttribute("data-dropdown-trigger"), o = e.getAttribute("data-dropdown-delay"), l = e.getAttribute("data-dropdown-ignore-click-outside-class");
      new Dropdown(n, e, {
        placement: i || Default$9.placement,
        triggerType: s || Default$9.triggerType,
        offsetSkidding: r ? parseInt(r) : Default$9.offsetSkidding,
        offsetDistance: a ? parseInt(a) : Default$9.offsetDistance,
        delay: o ? parseInt(o) : Default$9.delay,
        ignoreClickOutsideClass: l || Default$9.ignoreClickOutsideClass
      });
    } else
      console.error('The dropdown element with id "'.concat(t, '" does not exist. Please check the data-dropdown-toggle attribute.'));
  });
}
typeof window < "u" && (window.Dropdown = Dropdown, window.initDropdowns = initDropdowns);
var __assign$8 = function() {
  return __assign$8 = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign$8.apply(this, arguments);
}, Default$8 = {
  placement: "center",
  backdropClasses: "bg-dark-backdrop/70 fixed inset-0 z-40",
  backdrop: "dynamic",
  closable: !0,
  onHide: function() {
  },
  onShow: function() {
  },
  onToggle: function() {
  }
}, DefaultInstanceOptions$8 = {
  id: null,
  override: !0
}, Modal = (
  /** @class */
  (function() {
    function e(t, n, i) {
      t === void 0 && (t = null), n === void 0 && (n = Default$8), i === void 0 && (i = DefaultInstanceOptions$8), this._eventListenerInstances = [], this._instanceId = i.id ? i.id : t.id, this._targetEl = t, this._options = __assign$8(__assign$8({}, Default$8), n), this._isHidden = !0, this._backdropEl = null, this._initialized = !1, this.init(), instances.addInstance("Modal", this, this._instanceId, i.override);
    }
    return e.prototype.init = function() {
      var t = this;
      this._targetEl && !this._initialized && (this._getPlacementClasses().map(function(n) {
        t._targetEl.classList.add(n);
      }), this._initialized = !0);
    }, e.prototype.destroy = function() {
      this._initialized && (this.removeAllEventListenerInstances(), this._destroyBackdropEl(), this._initialized = !1);
    }, e.prototype.removeInstance = function() {
      instances.removeInstance("Modal", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype._createBackdrop = function() {
      var t;
      if (this._isHidden) {
        var n = document.createElement("div");
        (t = n.classList).add.apply(t, this._options.backdropClasses.split(" ")), document.querySelector("body").append(n), this._backdropEl = n;
      }
    }, e.prototype._destroyBackdropEl = function() {
      !this._isHidden && this._backdropEl && (this._backdropEl.remove(), this._backdropEl = null);
    }, e.prototype._setupModalCloseEventListeners = function() {
      var t = this;
      this._options.backdrop === "dynamic" && (this._clickOutsideEventListener = function(n) {
        t._handleOutsideClick(n.target);
      }, this._targetEl.addEventListener("click", this._clickOutsideEventListener, !0)), this._keydownEventListener = function(n) {
        n.key === "Escape" && t.hide();
      }, document.body.addEventListener("keydown", this._keydownEventListener, !0);
    }, e.prototype._removeModalCloseEventListeners = function() {
      this._options.backdrop === "dynamic" && this._targetEl.removeEventListener("click", this._clickOutsideEventListener, !0), document.body.removeEventListener("keydown", this._keydownEventListener, !0);
    }, e.prototype._handleOutsideClick = function(t) {
      (t === this._targetEl || t === this._backdropEl && this.isVisible()) && this.hide();
    }, e.prototype._getPlacementClasses = function() {
      switch (this._options.placement) {
        // top
        case "top-left":
          return ["justify-start", "items-start"];
        case "top-center":
          return ["justify-center", "items-start"];
        case "top-right":
          return ["justify-end", "items-start"];
        // center
        case "center-left":
          return ["justify-start", "items-center"];
        case "center":
          return ["justify-center", "items-center"];
        case "center-right":
          return ["justify-end", "items-center"];
        // bottom
        case "bottom-left":
          return ["justify-start", "items-end"];
        case "bottom-center":
          return ["justify-center", "items-end"];
        case "bottom-right":
          return ["justify-end", "items-end"];
        default:
          return ["justify-center", "items-center"];
      }
    }, e.prototype.toggle = function() {
      this._isHidden ? this.show() : this.hide(), this._options.onToggle(this);
    }, e.prototype.show = function() {
      this.isHidden && (this._targetEl.classList.add("flex"), this._targetEl.classList.remove("hidden"), this._targetEl.setAttribute("aria-modal", "true"), this._targetEl.setAttribute("role", "dialog"), this._targetEl.removeAttribute("aria-hidden"), this._createBackdrop(), this._isHidden = !1, this._options.closable && this._setupModalCloseEventListeners(), document.body.classList.add("overflow-hidden"), this._options.onShow(this));
    }, e.prototype.hide = function() {
      this.isVisible && (this._targetEl.classList.add("hidden"), this._targetEl.classList.remove("flex"), this._targetEl.setAttribute("aria-hidden", "true"), this._targetEl.removeAttribute("aria-modal"), this._targetEl.removeAttribute("role"), this._destroyBackdropEl(), this._isHidden = !0, document.body.classList.remove("overflow-hidden"), this._options.closable && this._removeModalCloseEventListeners(), this._options.onHide(this));
    }, e.prototype.isVisible = function() {
      return !this._isHidden;
    }, e.prototype.isHidden = function() {
      return this._isHidden;
    }, e.prototype.addEventListenerInstance = function(t, n, i) {
      this._eventListenerInstances.push({
        element: t,
        type: n,
        handler: i
      });
    }, e.prototype.removeAllEventListenerInstances = function() {
      this._eventListenerInstances.map(function(t) {
        t.element.removeEventListener(t.type, t.handler);
      }), this._eventListenerInstances = [];
    }, e.prototype.getAllEventListenerInstances = function() {
      return this._eventListenerInstances;
    }, e.prototype.updateOnShow = function(t) {
      this._options.onShow = t;
    }, e.prototype.updateOnHide = function(t) {
      this._options.onHide = t;
    }, e.prototype.updateOnToggle = function(t) {
      this._options.onToggle = t;
    }, e;
  })()
);
function initModals() {
  document.querySelectorAll("[data-modal-target]").forEach(function(e) {
    var t = e.getAttribute("data-modal-target"), n = document.getElementById(t);
    if (n) {
      var i = n.getAttribute("data-modal-placement"), r = n.getAttribute("data-modal-backdrop");
      new Modal(n, {
        placement: i || Default$8.placement,
        backdrop: r || Default$8.backdrop
      });
    } else
      console.error("Modal with id ".concat(t, " does not exist. Are you sure that the data-modal-target attribute points to the correct modal id?."));
  }), document.querySelectorAll("[data-modal-toggle]").forEach(function(e) {
    var t = e.getAttribute("data-modal-toggle"), n = document.getElementById(t);
    if (n) {
      var i = instances.getInstance("Modal", t);
      if (i) {
        var r = function() {
          i.toggle();
        };
        e.addEventListener("click", r), i.addEventListenerInstance(e, "click", r);
      } else
        console.error("Modal with id ".concat(t, " has not been initialized. Please initialize it using the data-modal-target attribute."));
    } else
      console.error("Modal with id ".concat(t, " does not exist. Are you sure that the data-modal-toggle attribute points to the correct modal id?"));
  }), document.querySelectorAll("[data-modal-show]").forEach(function(e) {
    var t = e.getAttribute("data-modal-show"), n = document.getElementById(t);
    if (n) {
      var i = instances.getInstance("Modal", t);
      if (i) {
        var r = function() {
          i.show();
        };
        e.addEventListener("click", r), i.addEventListenerInstance(e, "click", r);
      } else
        console.error("Modal with id ".concat(t, " has not been initialized. Please initialize it using the data-modal-target attribute."));
    } else
      console.error("Modal with id ".concat(t, " does not exist. Are you sure that the data-modal-show attribute points to the correct modal id?"));
  }), document.querySelectorAll("[data-modal-hide]").forEach(function(e) {
    var t = e.getAttribute("data-modal-hide"), n = document.getElementById(t);
    if (n) {
      var i = instances.getInstance("Modal", t);
      if (i) {
        var r = function() {
          i.hide();
        };
        e.addEventListener("click", r), i.addEventListenerInstance(e, "click", r);
      } else
        console.error("Modal with id ".concat(t, " has not been initialized. Please initialize it using the data-modal-target attribute."));
    } else
      console.error("Modal with id ".concat(t, " does not exist. Are you sure that the data-modal-hide attribute points to the correct modal id?"));
  });
}
typeof window < "u" && (window.Modal = Modal, window.initModals = initModals);
var __assign$7 = function() {
  return __assign$7 = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign$7.apply(this, arguments);
}, Default$7 = {
  placement: "left",
  bodyScrolling: !1,
  backdrop: !0,
  edge: !1,
  edgeOffset: "bottom-[60px]",
  backdropClasses: "bg-dark-backdrop/70 fixed inset-0 z-30",
  onShow: function() {
  },
  onHide: function() {
  },
  onToggle: function() {
  }
}, DefaultInstanceOptions$7 = {
  id: null,
  override: !0
}, Drawer = (
  /** @class */
  (function() {
    function e(t, n, i) {
      t === void 0 && (t = null), n === void 0 && (n = Default$7), i === void 0 && (i = DefaultInstanceOptions$7), this._eventListenerInstances = [], this._instanceId = i.id ? i.id : t.id, this._targetEl = t, this._options = __assign$7(__assign$7({}, Default$7), n), this._visible = !1, this._initialized = !1, this.init(), instances.addInstance("Drawer", this, this._instanceId, i.override);
    }
    return e.prototype.init = function() {
      var t = this;
      this._targetEl && !this._initialized && (this._targetEl.setAttribute("aria-hidden", "true"), this._targetEl.classList.add("transition-transform"), this._getPlacementClasses(this._options.placement).base.map(function(n) {
        t._targetEl.classList.add(n);
      }), this._handleEscapeKey = function(n) {
        n.key === "Escape" && t.isVisible() && t.hide();
      }, document.addEventListener("keydown", this._handleEscapeKey), this._initialized = !0);
    }, e.prototype.destroy = function() {
      this._initialized && (this.removeAllEventListenerInstances(), this._destroyBackdropEl(), document.removeEventListener("keydown", this._handleEscapeKey), this._initialized = !1);
    }, e.prototype.removeInstance = function() {
      instances.removeInstance("Drawer", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype.hide = function() {
      var t = this;
      this._options.edge ? (this._getPlacementClasses(this._options.placement + "-edge").active.map(function(n) {
        t._targetEl.classList.remove(n);
      }), this._getPlacementClasses(this._options.placement + "-edge").inactive.map(function(n) {
        t._targetEl.classList.add(n);
      })) : (this._getPlacementClasses(this._options.placement).active.map(function(n) {
        t._targetEl.classList.remove(n);
      }), this._getPlacementClasses(this._options.placement).inactive.map(function(n) {
        t._targetEl.classList.add(n);
      })), this._targetEl.setAttribute("aria-hidden", "true"), this._targetEl.removeAttribute("aria-modal"), this._targetEl.removeAttribute("role"), this._options.bodyScrolling || document.body.classList.remove("overflow-hidden"), this._options.backdrop && this._destroyBackdropEl(), this._visible = !1, this._options.onHide(this);
    }, e.prototype.show = function() {
      var t = this;
      this._options.edge ? (this._getPlacementClasses(this._options.placement + "-edge").active.map(function(n) {
        t._targetEl.classList.add(n);
      }), this._getPlacementClasses(this._options.placement + "-edge").inactive.map(function(n) {
        t._targetEl.classList.remove(n);
      })) : (this._getPlacementClasses(this._options.placement).active.map(function(n) {
        t._targetEl.classList.add(n);
      }), this._getPlacementClasses(this._options.placement).inactive.map(function(n) {
        t._targetEl.classList.remove(n);
      })), this._targetEl.setAttribute("aria-modal", "true"), this._targetEl.setAttribute("role", "dialog"), this._targetEl.removeAttribute("aria-hidden"), this._options.bodyScrolling || document.body.classList.add("overflow-hidden"), this._options.backdrop && this._createBackdrop(), this._visible = !0, this._options.onShow(this);
    }, e.prototype.toggle = function() {
      this.isVisible() ? this.hide() : this.show();
    }, e.prototype._createBackdrop = function() {
      var t, n = this;
      if (!this._visible) {
        var i = document.createElement("div");
        i.setAttribute("drawer-backdrop", ""), (t = i.classList).add.apply(t, this._options.backdropClasses.split(" ")), document.querySelector("body").append(i), i.addEventListener("click", function() {
          n.hide();
        });
      }
    }, e.prototype._destroyBackdropEl = function() {
      this._visible && document.querySelector("[drawer-backdrop]") !== null && document.querySelector("[drawer-backdrop]").remove();
    }, e.prototype._getPlacementClasses = function(t) {
      switch (t) {
        case "top":
          return {
            base: ["top-0", "left-0", "right-0"],
            active: ["transform-none"],
            inactive: ["-translate-y-full"]
          };
        case "right":
          return {
            base: ["right-0", "top-0"],
            active: ["transform-none"],
            inactive: ["translate-x-full"]
          };
        case "bottom":
          return {
            base: ["bottom-0", "left-0", "right-0"],
            active: ["transform-none"],
            inactive: ["translate-y-full"]
          };
        case "left":
          return {
            base: ["left-0", "top-0"],
            active: ["transform-none"],
            inactive: ["-translate-x-full"]
          };
        case "bottom-edge":
          return {
            base: ["left-0", "top-0"],
            active: ["transform-none"],
            inactive: ["translate-y-full", this._options.edgeOffset]
          };
        default:
          return {
            base: ["left-0", "top-0"],
            active: ["transform-none"],
            inactive: ["-translate-x-full"]
          };
      }
    }, e.prototype.isHidden = function() {
      return !this._visible;
    }, e.prototype.isVisible = function() {
      return this._visible;
    }, e.prototype.addEventListenerInstance = function(t, n, i) {
      this._eventListenerInstances.push({
        element: t,
        type: n,
        handler: i
      });
    }, e.prototype.removeAllEventListenerInstances = function() {
      this._eventListenerInstances.map(function(t) {
        t.element.removeEventListener(t.type, t.handler);
      }), this._eventListenerInstances = [];
    }, e.prototype.getAllEventListenerInstances = function() {
      return this._eventListenerInstances;
    }, e.prototype.updateOnShow = function(t) {
      this._options.onShow = t;
    }, e.prototype.updateOnHide = function(t) {
      this._options.onHide = t;
    }, e.prototype.updateOnToggle = function(t) {
      this._options.onToggle = t;
    }, e;
  })()
);
function initDrawers() {
  document.querySelectorAll("[data-drawer-target]").forEach(function(e) {
    var t = e.getAttribute("data-drawer-target"), n = document.getElementById(t);
    if (n) {
      var i = e.getAttribute("data-drawer-placement"), r = e.getAttribute("data-drawer-body-scrolling"), a = e.getAttribute("data-drawer-backdrop"), s = e.getAttribute("data-drawer-edge"), o = e.getAttribute("data-drawer-edge-offset");
      new Drawer(n, {
        placement: i || Default$7.placement,
        bodyScrolling: r ? r === "true" : Default$7.bodyScrolling,
        backdrop: a ? a === "true" : Default$7.backdrop,
        edge: s ? s === "true" : Default$7.edge,
        edgeOffset: o || Default$7.edgeOffset
      });
    } else
      console.error("Drawer with id ".concat(t, " not found. Are you sure that the data-drawer-target attribute points to the correct drawer id?"));
  }), document.querySelectorAll("[data-drawer-toggle]").forEach(function(e) {
    var t = e.getAttribute("data-drawer-toggle"), n = document.getElementById(t);
    if (n) {
      var i = instances.getInstance("Drawer", t);
      if (i) {
        var r = function() {
          i.toggle();
        };
        e.addEventListener("click", r), i.addEventListenerInstance(e, "click", r);
      } else
        console.error("Drawer with id ".concat(t, " has not been initialized. Please initialize it using the data-drawer-target attribute."));
    } else
      console.error("Drawer with id ".concat(t, " not found. Are you sure that the data-drawer-target attribute points to the correct drawer id?"));
  }), document.querySelectorAll("[data-drawer-dismiss], [data-drawer-hide]").forEach(function(e) {
    var t = e.getAttribute("data-drawer-dismiss") ? e.getAttribute("data-drawer-dismiss") : e.getAttribute("data-drawer-hide"), n = document.getElementById(t);
    if (n) {
      var i = instances.getInstance("Drawer", t);
      if (i) {
        var r = function() {
          i.hide();
        };
        e.addEventListener("click", r), i.addEventListenerInstance(e, "click", r);
      } else
        console.error("Drawer with id ".concat(t, " has not been initialized. Please initialize it using the data-drawer-target attribute."));
    } else
      console.error("Drawer with id ".concat(t, " not found. Are you sure that the data-drawer-target attribute points to the correct drawer id"));
  }), document.querySelectorAll("[data-drawer-show]").forEach(function(e) {
    var t = e.getAttribute("data-drawer-show"), n = document.getElementById(t);
    if (n) {
      var i = instances.getInstance("Drawer", t);
      if (i) {
        var r = function() {
          i.show();
        };
        e.addEventListener("click", r), i.addEventListenerInstance(e, "click", r);
      } else
        console.error("Drawer with id ".concat(t, " has not been initialized. Please initialize it using the data-drawer-target attribute."));
    } else
      console.error("Drawer with id ".concat(t, " not found. Are you sure that the data-drawer-target attribute points to the correct drawer id?"));
  });
}
typeof window < "u" && (window.Drawer = Drawer, window.initDrawers = initDrawers);
var __assign$6 = function() {
  return __assign$6 = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign$6.apply(this, arguments);
}, Default$6 = {
  defaultTabId: null,
  activeClasses: "text-fg-brand hover:text-fg-brand border-brand",
  inactiveClasses: "border-transparent text-body hover:text-heading border-soft hover:border-default",
  onShow: function() {
  }
}, DefaultInstanceOptions$6 = {
  id: null,
  override: !0
}, Tabs = (
  /** @class */
  (function() {
    function e(t, n, i, r) {
      t === void 0 && (t = null), n === void 0 && (n = []), i === void 0 && (i = Default$6), r === void 0 && (r = DefaultInstanceOptions$6), this._instanceId = r.id ? r.id : t.id, this._tabsEl = t, this._items = n, this._activeTab = i ? this.getTab(i.defaultTabId) : null, this._options = __assign$6(__assign$6({}, Default$6), i), this._initialized = !1, this.init(), instances.addInstance("Tabs", this, this._instanceId, r.override);
    }
    return e.prototype.init = function() {
      var t = this;
      this._items.length && !this._initialized && (this._activeTab || this.setActiveTab(this._items[0]), this.show(this._activeTab.id, !0), this._items.map(function(n) {
        n.triggerEl.addEventListener("click", function(i) {
          i.preventDefault(), t.show(n.id);
        });
      }));
    }, e.prototype.destroy = function() {
      this._initialized && (this._initialized = !1);
    }, e.prototype.removeInstance = function() {
      this.destroy(), instances.removeInstance("Tabs", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype.getActiveTab = function() {
      return this._activeTab;
    }, e.prototype.setActiveTab = function(t) {
      this._activeTab = t;
    }, e.prototype.getTab = function(t) {
      return this._items.filter(function(n) {
        return n.id === t;
      })[0];
    }, e.prototype.show = function(t, n) {
      var i, r, a = this;
      n === void 0 && (n = !1);
      var s = this.getTab(t);
      s === this._activeTab && !n || (this._items.map(function(o) {
        var l, c;
        o !== s && ((l = o.triggerEl.classList).remove.apply(l, a._options.activeClasses.split(" ")), (c = o.triggerEl.classList).add.apply(c, a._options.inactiveClasses.split(" ")), o.targetEl.classList.add("hidden"), o.triggerEl.setAttribute("aria-selected", "false"));
      }), (i = s.triggerEl.classList).add.apply(i, this._options.activeClasses.split(" ")), (r = s.triggerEl.classList).remove.apply(r, this._options.inactiveClasses.split(" ")), s.triggerEl.setAttribute("aria-selected", "true"), s.targetEl.classList.remove("hidden"), this.setActiveTab(s), this._options.onShow(this, s));
    }, e.prototype.updateOnShow = function(t) {
      this._options.onShow = t;
    }, e;
  })()
);
function initTabs() {
  document.querySelectorAll("[data-tabs-toggle]").forEach(function(e) {
    var t = [], n = e.getAttribute("data-tabs-active-classes"), i = e.getAttribute("data-tabs-inactive-classes"), r = null;
    e.querySelectorAll('[role="tab"]').forEach(function(a) {
      var s = a.getAttribute("aria-selected") === "true", o = {
        id: a.getAttribute("data-tabs-target"),
        triggerEl: a,
        targetEl: document.querySelector(a.getAttribute("data-tabs-target"))
      };
      t.push(o), s && (r = o.id);
    }), new Tabs(e, t, {
      defaultTabId: r,
      activeClasses: n || Default$6.activeClasses,
      inactiveClasses: i || Default$6.inactiveClasses
    });
  });
}
typeof window < "u" && (window.Tabs = Tabs, window.initTabs = initTabs);
var __assign$5 = function() {
  return __assign$5 = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign$5.apply(this, arguments);
}, __spreadArray$1 = function(e, t, n) {
  if (n || arguments.length === 2) for (var i = 0, r = t.length, a; i < r; i++)
    (a || !(i in t)) && (a || (a = Array.prototype.slice.call(t, 0, i)), a[i] = t[i]);
  return e.concat(a || Array.prototype.slice.call(t));
}, Default$5 = {
  placement: "top",
  triggerType: "hover",
  onShow: function() {
  },
  onHide: function() {
  },
  onToggle: function() {
  }
}, DefaultInstanceOptions$5 = {
  id: null,
  override: !0
}, Tooltip = (
  /** @class */
  (function() {
    function e(t, n, i, r) {
      t === void 0 && (t = null), n === void 0 && (n = null), i === void 0 && (i = Default$5), r === void 0 && (r = DefaultInstanceOptions$5), this._instanceId = r.id ? r.id : t.id, this._targetEl = t, this._triggerEl = n, this._options = __assign$5(__assign$5({}, Default$5), i), this._popperInstance = null, this._visible = !1, this._initialized = !1, this.init(), instances.addInstance("Tooltip", this, this._instanceId, r.override);
    }
    return e.prototype.init = function() {
      this._triggerEl && this._targetEl && !this._initialized && (this._setupEventListeners(), this._popperInstance = this._createPopperInstance(), this._initialized = !0);
    }, e.prototype.destroy = function() {
      var t = this;
      if (this._initialized) {
        var n = this._getTriggerEvents();
        n.showEvents.forEach(function(i) {
          t._triggerEl.removeEventListener(i, t._showHandler);
        }), n.hideEvents.forEach(function(i) {
          t._triggerEl.removeEventListener(i, t._hideHandler);
        }), this._removeKeydownListener(), this._removeClickOutsideListener(), this._popperInstance && this._popperInstance.destroy(), this._initialized = !1;
      }
    }, e.prototype.removeInstance = function() {
      instances.removeInstance("Tooltip", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype._setupEventListeners = function() {
      var t = this, n = this._getTriggerEvents();
      this._showHandler = function() {
        t.show();
      }, this._hideHandler = function() {
        t.hide();
      }, n.showEvents.forEach(function(i) {
        t._triggerEl.addEventListener(i, t._showHandler);
      }), n.hideEvents.forEach(function(i) {
        t._triggerEl.addEventListener(i, t._hideHandler);
      });
    }, e.prototype._createPopperInstance = function() {
      return createPopper(this._triggerEl, this._targetEl, {
        placement: this._options.placement,
        modifiers: [
          {
            name: "offset",
            options: {
              offset: [0, 8]
            }
          }
        ]
      });
    }, e.prototype._getTriggerEvents = function() {
      switch (this._options.triggerType) {
        case "hover":
          return {
            showEvents: ["mouseenter", "focus"],
            hideEvents: ["mouseleave", "blur"]
          };
        case "click":
          return {
            showEvents: ["click", "focus"],
            hideEvents: ["focusout", "blur"]
          };
        case "none":
          return {
            showEvents: [],
            hideEvents: []
          };
        default:
          return {
            showEvents: ["mouseenter", "focus"],
            hideEvents: ["mouseleave", "blur"]
          };
      }
    }, e.prototype._setupKeydownListener = function() {
      var t = this;
      this._keydownEventListener = function(n) {
        n.key === "Escape" && t.hide();
      }, document.body.addEventListener("keydown", this._keydownEventListener, !0);
    }, e.prototype._removeKeydownListener = function() {
      document.body.removeEventListener("keydown", this._keydownEventListener, !0);
    }, e.prototype._setupClickOutsideListener = function() {
      var t = this;
      this._clickOutsideEventListener = function(n) {
        t._handleClickOutside(n, t._targetEl);
      }, document.body.addEventListener("click", this._clickOutsideEventListener, !0);
    }, e.prototype._removeClickOutsideListener = function() {
      document.body.removeEventListener("click", this._clickOutsideEventListener, !0);
    }, e.prototype._handleClickOutside = function(t, n) {
      var i = t.target;
      i !== n && !n.contains(i) && !this._triggerEl.contains(i) && this.isVisible() && this.hide();
    }, e.prototype.isVisible = function() {
      return this._visible;
    }, e.prototype.toggle = function() {
      this.isVisible() ? this.hide() : this.show();
    }, e.prototype.show = function() {
      this._targetEl.classList.remove("opacity-0", "invisible"), this._targetEl.classList.add("opacity-100", "visible"), this._popperInstance.setOptions(function(t) {
        return __assign$5(__assign$5({}, t), { modifiers: __spreadArray$1(__spreadArray$1([], t.modifiers, !0), [
          { name: "eventListeners", enabled: !0 }
        ], !1) });
      }), this._setupClickOutsideListener(), this._setupKeydownListener(), this._popperInstance.update(), this._visible = !0, this._options.onShow(this);
    }, e.prototype.hide = function() {
      this._targetEl.classList.remove("opacity-100", "visible"), this._targetEl.classList.add("opacity-0", "invisible"), this._popperInstance.setOptions(function(t) {
        return __assign$5(__assign$5({}, t), { modifiers: __spreadArray$1(__spreadArray$1([], t.modifiers, !0), [
          { name: "eventListeners", enabled: !1 }
        ], !1) });
      }), this._removeClickOutsideListener(), this._removeKeydownListener(), this._visible = !1, this._options.onHide(this);
    }, e.prototype.updateOnShow = function(t) {
      this._options.onShow = t;
    }, e.prototype.updateOnHide = function(t) {
      this._options.onHide = t;
    }, e.prototype.updateOnToggle = function(t) {
      this._options.onToggle = t;
    }, e;
  })()
);
function initTooltips() {
  document.querySelectorAll("[data-tooltip-target]").forEach(function(e) {
    var t = e.getAttribute("data-tooltip-target"), n = document.getElementById(t);
    if (n) {
      var i = e.getAttribute("data-tooltip-trigger"), r = e.getAttribute("data-tooltip-placement");
      new Tooltip(n, e, {
        placement: r || Default$5.placement,
        triggerType: i || Default$5.triggerType
      });
    } else
      console.error('The tooltip element with id "'.concat(t, '" does not exist. Please check the data-tooltip-target attribute.'));
  });
}
typeof window < "u" && (window.Tooltip = Tooltip, window.initTooltips = initTooltips);
var __assign$4 = function() {
  return __assign$4 = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign$4.apply(this, arguments);
}, __spreadArray = function(e, t, n) {
  if (n || arguments.length === 2) for (var i = 0, r = t.length, a; i < r; i++)
    (a || !(i in t)) && (a || (a = Array.prototype.slice.call(t, 0, i)), a[i] = t[i]);
  return e.concat(a || Array.prototype.slice.call(t));
}, Default$4 = {
  placement: "top",
  offset: 10,
  triggerType: "hover",
  onShow: function() {
  },
  onHide: function() {
  },
  onToggle: function() {
  }
}, DefaultInstanceOptions$4 = {
  id: null,
  override: !0
}, Popover = (
  /** @class */
  (function() {
    function e(t, n, i, r) {
      t === void 0 && (t = null), n === void 0 && (n = null), i === void 0 && (i = Default$4), r === void 0 && (r = DefaultInstanceOptions$4), this._instanceId = r.id ? r.id : t.id, this._targetEl = t, this._triggerEl = n, this._options = __assign$4(__assign$4({}, Default$4), i), this._popperInstance = null, this._visible = !1, this._initialized = !1, this.init(), instances.addInstance("Popover", this, r.id ? r.id : this._targetEl.id, r.override);
    }
    return e.prototype.init = function() {
      this._triggerEl && this._targetEl && !this._initialized && (this._setupEventListeners(), this._popperInstance = this._createPopperInstance(), this._initialized = !0);
    }, e.prototype.destroy = function() {
      var t = this;
      if (this._initialized) {
        var n = this._getTriggerEvents();
        n.showEvents.forEach(function(i) {
          t._triggerEl.removeEventListener(i, t._showHandler), t._targetEl.removeEventListener(i, t._showHandler);
        }), n.hideEvents.forEach(function(i) {
          t._triggerEl.removeEventListener(i, t._hideHandler), t._targetEl.removeEventListener(i, t._hideHandler);
        }), this._removeKeydownListener(), this._removeClickOutsideListener(), this._popperInstance && this._popperInstance.destroy(), this._initialized = !1;
      }
    }, e.prototype.removeInstance = function() {
      instances.removeInstance("Popover", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype._setupEventListeners = function() {
      var t = this, n = this._getTriggerEvents();
      this._showHandler = function() {
        t.show();
      }, this._hideHandler = function() {
        setTimeout(function() {
          t._targetEl.matches(":hover") || t.hide();
        }, 100);
      }, n.showEvents.forEach(function(i) {
        t._triggerEl.addEventListener(i, t._showHandler), t._targetEl.addEventListener(i, t._showHandler);
      }), n.hideEvents.forEach(function(i) {
        t._triggerEl.addEventListener(i, t._hideHandler), t._targetEl.addEventListener(i, t._hideHandler);
      });
    }, e.prototype._createPopperInstance = function() {
      return createPopper(this._triggerEl, this._targetEl, {
        placement: this._options.placement,
        modifiers: [
          {
            name: "offset",
            options: {
              offset: [0, this._options.offset]
            }
          }
        ]
      });
    }, e.prototype._getTriggerEvents = function() {
      switch (this._options.triggerType) {
        case "hover":
          return {
            showEvents: ["mouseenter", "focus"],
            hideEvents: ["mouseleave", "blur"]
          };
        case "click":
          return {
            showEvents: ["click", "focus"],
            hideEvents: ["focusout", "blur"]
          };
        case "none":
          return {
            showEvents: [],
            hideEvents: []
          };
        default:
          return {
            showEvents: ["mouseenter", "focus"],
            hideEvents: ["mouseleave", "blur"]
          };
      }
    }, e.prototype._setupKeydownListener = function() {
      var t = this;
      this._keydownEventListener = function(n) {
        n.key === "Escape" && t.hide();
      }, document.body.addEventListener("keydown", this._keydownEventListener, !0);
    }, e.prototype._removeKeydownListener = function() {
      document.body.removeEventListener("keydown", this._keydownEventListener, !0);
    }, e.prototype._setupClickOutsideListener = function() {
      var t = this;
      this._clickOutsideEventListener = function(n) {
        t._handleClickOutside(n, t._targetEl);
      }, document.body.addEventListener("click", this._clickOutsideEventListener, !0);
    }, e.prototype._removeClickOutsideListener = function() {
      document.body.removeEventListener("click", this._clickOutsideEventListener, !0);
    }, e.prototype._handleClickOutside = function(t, n) {
      var i = t.target;
      i !== n && !n.contains(i) && !this._triggerEl.contains(i) && this.isVisible() && this.hide();
    }, e.prototype.isVisible = function() {
      return this._visible;
    }, e.prototype.toggle = function() {
      this.isVisible() ? this.hide() : this.show(), this._options.onToggle(this);
    }, e.prototype.show = function() {
      this._targetEl.classList.remove("opacity-0", "invisible"), this._targetEl.classList.add("opacity-100", "visible"), this._popperInstance.setOptions(function(t) {
        return __assign$4(__assign$4({}, t), { modifiers: __spreadArray(__spreadArray([], t.modifiers, !0), [
          { name: "eventListeners", enabled: !0 }
        ], !1) });
      }), this._setupClickOutsideListener(), this._setupKeydownListener(), this._popperInstance.update(), this._visible = !0, this._options.onShow(this);
    }, e.prototype.hide = function() {
      this._targetEl.classList.remove("opacity-100", "visible"), this._targetEl.classList.add("opacity-0", "invisible"), this._popperInstance.setOptions(function(t) {
        return __assign$4(__assign$4({}, t), { modifiers: __spreadArray(__spreadArray([], t.modifiers, !0), [
          { name: "eventListeners", enabled: !1 }
        ], !1) });
      }), this._removeClickOutsideListener(), this._removeKeydownListener(), this._visible = !1, this._options.onHide(this);
    }, e.prototype.updateOnShow = function(t) {
      this._options.onShow = t;
    }, e.prototype.updateOnHide = function(t) {
      this._options.onHide = t;
    }, e.prototype.updateOnToggle = function(t) {
      this._options.onToggle = t;
    }, e;
  })()
);
function initPopovers() {
  document.querySelectorAll("[data-popover-target]").forEach(function(e) {
    var t = e.getAttribute("data-popover-target"), n = document.getElementById(t);
    if (n) {
      var i = e.getAttribute("data-popover-trigger"), r = e.getAttribute("data-popover-placement"), a = e.getAttribute("data-popover-offset");
      new Popover(n, e, {
        placement: r || Default$4.placement,
        offset: a ? parseInt(a) : Default$4.offset,
        triggerType: i || Default$4.triggerType
      });
    } else
      console.error('The popover element with id "'.concat(t, '" does not exist. Please check the data-popover-target attribute.'));
  });
}
typeof window < "u" && (window.Popover = Popover, window.initPopovers = initPopovers);
var __assign$3 = function() {
  return __assign$3 = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign$3.apply(this, arguments);
}, Default$3 = {
  triggerType: "hover",
  onShow: function() {
  },
  onHide: function() {
  },
  onToggle: function() {
  }
}, DefaultInstanceOptions$3 = {
  id: null,
  override: !0
}, Dial = (
  /** @class */
  (function() {
    function e(t, n, i, r, a) {
      t === void 0 && (t = null), n === void 0 && (n = null), i === void 0 && (i = null), r === void 0 && (r = Default$3), a === void 0 && (a = DefaultInstanceOptions$3), this._instanceId = a.id ? a.id : i.id, this._parentEl = t, this._triggerEl = n, this._targetEl = i, this._options = __assign$3(__assign$3({}, Default$3), r), this._visible = !1, this._initialized = !1, this.init(), instances.addInstance("Dial", this, this._instanceId, a.override);
    }
    return e.prototype.init = function() {
      var t = this;
      if (this._triggerEl && this._targetEl && !this._initialized) {
        var n = this._getTriggerEventTypes(this._options.triggerType);
        this._showEventHandler = function() {
          t.show();
        }, n.showEvents.forEach(function(i) {
          t._triggerEl.addEventListener(i, t._showEventHandler), t._targetEl.addEventListener(i, t._showEventHandler);
        }), this._hideEventHandler = function() {
          t._parentEl.matches(":hover") || t.hide();
        }, n.hideEvents.forEach(function(i) {
          t._parentEl.addEventListener(i, t._hideEventHandler);
        }), this._initialized = !0;
      }
    }, e.prototype.destroy = function() {
      var t = this;
      if (this._initialized) {
        var n = this._getTriggerEventTypes(this._options.triggerType);
        n.showEvents.forEach(function(i) {
          t._triggerEl.removeEventListener(i, t._showEventHandler), t._targetEl.removeEventListener(i, t._showEventHandler);
        }), n.hideEvents.forEach(function(i) {
          t._parentEl.removeEventListener(i, t._hideEventHandler);
        }), this._initialized = !1;
      }
    }, e.prototype.removeInstance = function() {
      instances.removeInstance("Dial", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype.hide = function() {
      this._targetEl.classList.add("hidden"), this._triggerEl && this._triggerEl.setAttribute("aria-expanded", "false"), this._visible = !1, this._options.onHide(this);
    }, e.prototype.show = function() {
      this._targetEl.classList.remove("hidden"), this._triggerEl && this._triggerEl.setAttribute("aria-expanded", "true"), this._visible = !0, this._options.onShow(this);
    }, e.prototype.toggle = function() {
      this._visible ? this.hide() : this.show();
    }, e.prototype.isHidden = function() {
      return !this._visible;
    }, e.prototype.isVisible = function() {
      return this._visible;
    }, e.prototype._getTriggerEventTypes = function(t) {
      switch (t) {
        case "hover":
          return {
            showEvents: ["mouseenter", "focus"],
            hideEvents: ["mouseleave", "blur"]
          };
        case "click":
          return {
            showEvents: ["click", "focus"],
            hideEvents: ["focusout", "blur"]
          };
        case "none":
          return {
            showEvents: [],
            hideEvents: []
          };
        default:
          return {
            showEvents: ["mouseenter", "focus"],
            hideEvents: ["mouseleave", "blur"]
          };
      }
    }, e.prototype.updateOnShow = function(t) {
      this._options.onShow = t;
    }, e.prototype.updateOnHide = function(t) {
      this._options.onHide = t;
    }, e.prototype.updateOnToggle = function(t) {
      this._options.onToggle = t;
    }, e;
  })()
);
function initDials() {
  document.querySelectorAll("[data-dial-init]").forEach(function(e) {
    var t = e.querySelector("[data-dial-toggle]");
    if (t) {
      var n = t.getAttribute("data-dial-toggle"), i = document.getElementById(n);
      if (i) {
        var r = t.getAttribute("data-dial-trigger");
        new Dial(e, t, i, {
          triggerType: r || Default$3.triggerType
        });
      } else
        console.error("Dial with id ".concat(n, " does not exist. Are you sure that the data-dial-toggle attribute points to the correct modal id?"));
    } else
      console.error("Dial with id ".concat(e.id, " does not have a trigger element. Are you sure that the data-dial-toggle attribute exists?"));
  });
}
typeof window < "u" && (window.Dial = Dial, window.initDials = initDials);
var __assign$2 = function() {
  return __assign$2 = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign$2.apply(this, arguments);
}, Default$2 = {
  minValue: null,
  maxValue: null,
  onIncrement: function() {
  },
  onDecrement: function() {
  }
}, DefaultInstanceOptions$2 = {
  id: null,
  override: !0
}, InputCounter = (
  /** @class */
  (function() {
    function e(t, n, i, r, a) {
      t === void 0 && (t = null), n === void 0 && (n = null), i === void 0 && (i = null), r === void 0 && (r = Default$2), a === void 0 && (a = DefaultInstanceOptions$2), this._instanceId = a.id ? a.id : t.id, this._targetEl = t, this._incrementEl = n, this._decrementEl = i, this._options = __assign$2(__assign$2({}, Default$2), r), this._initialized = !1, this.init(), instances.addInstance("InputCounter", this, this._instanceId, a.override);
    }
    return e.prototype.init = function() {
      var t = this;
      this._targetEl && !this._initialized && (this._inputHandler = function(n) {
        {
          var i = n.target;
          /^\d*$/.test(i.value) || (i.value = i.value.replace(/[^\d]/g, "")), t._options.maxValue !== null && parseInt(i.value) > t._options.maxValue && (i.value = t._options.maxValue.toString()), t._options.minValue !== null && parseInt(i.value) < t._options.minValue && (i.value = t._options.minValue.toString());
        }
      }, this._incrementClickHandler = function() {
        t.increment();
      }, this._decrementClickHandler = function() {
        t.decrement();
      }, this._targetEl.addEventListener("input", this._inputHandler), this._incrementEl && this._incrementEl.addEventListener("click", this._incrementClickHandler), this._decrementEl && this._decrementEl.addEventListener("click", this._decrementClickHandler), this._initialized = !0);
    }, e.prototype.destroy = function() {
      this._targetEl && this._initialized && (this._targetEl.removeEventListener("input", this._inputHandler), this._incrementEl && this._incrementEl.removeEventListener("click", this._incrementClickHandler), this._decrementEl && this._decrementEl.removeEventListener("click", this._decrementClickHandler), this._initialized = !1);
    }, e.prototype.removeInstance = function() {
      instances.removeInstance("InputCounter", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype.getCurrentValue = function() {
      return parseInt(this._targetEl.value) || 0;
    }, e.prototype.increment = function() {
      this._options.maxValue !== null && this.getCurrentValue() >= this._options.maxValue || (this._targetEl.value = (this.getCurrentValue() + 1).toString(), this._options.onIncrement(this));
    }, e.prototype.decrement = function() {
      this._options.minValue !== null && this.getCurrentValue() <= this._options.minValue || (this._targetEl.value = (this.getCurrentValue() - 1).toString(), this._options.onDecrement(this));
    }, e.prototype.updateOnIncrement = function(t) {
      this._options.onIncrement = t;
    }, e.prototype.updateOnDecrement = function(t) {
      this._options.onDecrement = t;
    }, e;
  })()
);
function initInputCounters() {
  document.querySelectorAll("[data-input-counter]").forEach(function(e) {
    var t = e.id, n = document.querySelector('[data-input-counter-increment="' + t + '"]'), i = document.querySelector('[data-input-counter-decrement="' + t + '"]'), r = e.getAttribute("data-input-counter-min"), a = e.getAttribute("data-input-counter-max");
    e ? instances.instanceExists("InputCounter", e.getAttribute("id")) || new InputCounter(e, n || null, i || null, {
      minValue: r ? parseInt(r) : null,
      maxValue: a ? parseInt(a) : null
    }) : console.error('The target element with id "'.concat(t, '" does not exist. Please check the data-input-counter attribute.'));
  });
}
typeof window < "u" && (window.InputCounter = InputCounter, window.initInputCounters = initInputCounters);
var __assign$1 = function() {
  return __assign$1 = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign$1.apply(this, arguments);
}, Default$1 = {
  htmlEntities: !1,
  contentType: "input",
  onCopy: function() {
  }
}, DefaultInstanceOptions$1 = {
  id: null,
  override: !0
}, CopyClipboard = (
  /** @class */
  (function() {
    function e(t, n, i, r) {
      t === void 0 && (t = null), n === void 0 && (n = null), i === void 0 && (i = Default$1), r === void 0 && (r = DefaultInstanceOptions$1), this._instanceId = r.id ? r.id : n.id, this._triggerEl = t, this._targetEl = n, this._options = __assign$1(__assign$1({}, Default$1), i), this._initialized = !1, this.init(), instances.addInstance("CopyClipboard", this, this._instanceId, r.override);
    }
    return e.prototype.init = function() {
      var t = this;
      this._targetEl && this._triggerEl && !this._initialized && (this._triggerElClickHandler = function() {
        t.copy();
      }, this._triggerEl && this._triggerEl.addEventListener("click", this._triggerElClickHandler), this._initialized = !0);
    }, e.prototype.destroy = function() {
      this._triggerEl && this._targetEl && this._initialized && (this._triggerEl && this._triggerEl.removeEventListener("click", this._triggerElClickHandler), this._initialized = !1);
    }, e.prototype.removeInstance = function() {
      instances.removeInstance("CopyClipboard", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype.getTargetValue = function() {
      if (this._options.contentType === "input")
        return this._targetEl.value;
      if (this._options.contentType === "innerHTML")
        return this._targetEl.innerHTML;
      if (this._options.contentType === "textContent")
        return this._targetEl.textContent.replace(/\s+/g, " ").trim();
    }, e.prototype.copy = function() {
      var t = this.getTargetValue();
      this._options.htmlEntities && (t = this.decodeHTML(t));
      var n = document.createElement("textarea");
      return n.value = t, document.body.appendChild(n), n.select(), document.execCommand("copy"), document.body.removeChild(n), this._options.onCopy(this), t;
    }, e.prototype.decodeHTML = function(t) {
      var n = document.createElement("textarea");
      return n.innerHTML = t, n.textContent;
    }, e.prototype.updateOnCopyCallback = function(t) {
      this._options.onCopy = t;
    }, e;
  })()
);
function initCopyClipboards() {
  document.querySelectorAll("[data-copy-to-clipboard-target]").forEach(function(e) {
    var t = e.getAttribute("data-copy-to-clipboard-target"), n = document.getElementById(t), i = e.getAttribute("data-copy-to-clipboard-content-type"), r = e.getAttribute("data-copy-to-clipboard-html-entities");
    n ? instances.instanceExists("CopyClipboard", n.getAttribute("id")) || new CopyClipboard(e, n, {
      htmlEntities: r && r === "true" ? !0 : Default$1.htmlEntities,
      contentType: i || Default$1.contentType
    }) : console.error('The target element with id "'.concat(t, '" does not exist. Please check the data-copy-to-clipboard-target attribute.'));
  });
}
typeof window < "u" && (window.CopyClipboard = CopyClipboard, window.initClipboards = initCopyClipboards);
function _arrayLikeToArray(e, t) {
  (t == null || t > e.length) && (t = e.length);
  for (var n = 0, i = Array(t); n < t; n++) i[n] = e[n];
  return i;
}
function _arrayWithHoles(e) {
  if (Array.isArray(e)) return e;
}
function _arrayWithoutHoles(e) {
  if (Array.isArray(e)) return _arrayLikeToArray(e);
}
function _assertThisInitialized(e) {
  if (e === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  return e;
}
function _callSuper(e, t, n) {
  return t = _getPrototypeOf(t), _possibleConstructorReturn(e, _isNativeReflectConstruct() ? Reflect.construct(t, n || [], _getPrototypeOf(e).constructor) : t.apply(e, n));
}
function _classCallCheck(e, t) {
  if (!(e instanceof t)) throw new TypeError("Cannot call a class as a function");
}
function _defineProperties(e, t) {
  for (var n = 0; n < t.length; n++) {
    var i = t[n];
    i.enumerable = i.enumerable || !1, i.configurable = !0, "value" in i && (i.writable = !0), Object.defineProperty(e, _toPropertyKey(i.key), i);
  }
}
function _createClass(e, t, n) {
  return t && _defineProperties(e.prototype, t), n && _defineProperties(e, n), Object.defineProperty(e, "prototype", {
    writable: !1
  }), e;
}
function _get() {
  return _get = typeof Reflect < "u" && Reflect.get ? Reflect.get.bind() : function(e, t, n) {
    var i = _superPropBase(e, t);
    if (i) {
      var r = Object.getOwnPropertyDescriptor(i, t);
      return r.get ? r.get.call(arguments.length < 3 ? e : n) : r.value;
    }
  }, _get.apply(null, arguments);
}
function _getPrototypeOf(e) {
  return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function(t) {
    return t.__proto__ || Object.getPrototypeOf(t);
  }, _getPrototypeOf(e);
}
function _inherits(e, t) {
  if (typeof t != "function" && t !== null) throw new TypeError("Super expression must either be null or a function");
  e.prototype = Object.create(t && t.prototype, {
    constructor: {
      value: e,
      writable: !0,
      configurable: !0
    }
  }), Object.defineProperty(e, "prototype", {
    writable: !1
  }), t && _setPrototypeOf(e, t);
}
function _isNativeReflectConstruct() {
  try {
    var e = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
    }));
  } catch {
  }
  return (_isNativeReflectConstruct = function() {
    return !!e;
  })();
}
function _iterableToArray(e) {
  if (typeof Symbol < "u" && e[Symbol.iterator] != null || e["@@iterator"] != null) return Array.from(e);
}
function _iterableToArrayLimit(e, t) {
  var n = e == null ? null : typeof Symbol < "u" && e[Symbol.iterator] || e["@@iterator"];
  if (n != null) {
    var i, r, a, s, o = [], l = !0, c = !1;
    try {
      if (a = (n = n.call(e)).next, t === 0) {
        if (Object(n) !== n) return;
        l = !1;
      } else for (; !(l = (i = a.call(n)).done) && (o.push(i.value), o.length !== t); l = !0) ;
    } catch (u) {
      c = !0, r = u;
    } finally {
      try {
        if (!l && n.return != null && (s = n.return(), Object(s) !== s)) return;
      } finally {
        if (c) throw r;
      }
    }
    return o;
  }
}
function _nonIterableRest() {
  throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
}
function _nonIterableSpread() {
  throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
}
function _possibleConstructorReturn(e, t) {
  if (t && (typeof t == "object" || typeof t == "function")) return t;
  if (t !== void 0) throw new TypeError("Derived constructors may only return object or undefined");
  return _assertThisInitialized(e);
}
function _setPrototypeOf(e, t) {
  return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function(n, i) {
    return n.__proto__ = i, n;
  }, _setPrototypeOf(e, t);
}
function _slicedToArray(e, t) {
  return _arrayWithHoles(e) || _iterableToArrayLimit(e, t) || _unsupportedIterableToArray(e, t) || _nonIterableRest();
}
function _superPropBase(e, t) {
  for (; !{}.hasOwnProperty.call(e, t) && (e = _getPrototypeOf(e)) !== null; ) ;
  return e;
}
function _toConsumableArray(e) {
  return _arrayWithoutHoles(e) || _iterableToArray(e) || _unsupportedIterableToArray(e) || _nonIterableSpread();
}
function _toPrimitive(e, t) {
  if (typeof e != "object" || !e) return e;
  var n = e[Symbol.toPrimitive];
  if (n !== void 0) {
    var i = n.call(e, t);
    if (typeof i != "object") return i;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return String(e);
}
function _toPropertyKey(e) {
  var t = _toPrimitive(e, "string");
  return typeof t == "symbol" ? t : t + "";
}
function _typeof(e) {
  "@babel/helpers - typeof";
  return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(t) {
    return typeof t;
  } : function(t) {
    return t && typeof Symbol == "function" && t.constructor === Symbol && t !== Symbol.prototype ? "symbol" : typeof t;
  }, _typeof(e);
}
function _unsupportedIterableToArray(e, t) {
  if (e) {
    if (typeof e == "string") return _arrayLikeToArray(e, t);
    var n = {}.toString.call(e).slice(8, -1);
    return n === "Object" && e.constructor && (n = e.constructor.name), n === "Map" || n === "Set" ? Array.from(e) : n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n) ? _arrayLikeToArray(e, t) : void 0;
  }
}
function hasProperty(e, t) {
  return Object.prototype.hasOwnProperty.call(e, t);
}
function lastItemOf(e) {
  return e[e.length - 1];
}
function pushUnique(e) {
  for (var t = arguments.length, n = new Array(t > 1 ? t - 1 : 0), i = 1; i < t; i++)
    n[i - 1] = arguments[i];
  return n.forEach(function(r) {
    e.includes(r) || e.push(r);
  }), e;
}
function stringToArray(e, t) {
  return e ? e.split(t) : [];
}
function isInRange(e, t, n) {
  var i = t === void 0 || e >= t, r = n === void 0 || e <= n;
  return i && r;
}
function limitToRange(e, t, n) {
  return e < t ? t : e > n ? n : e;
}
function createTagRepeat(e, t) {
  var n = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {}, i = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : 0, r = arguments.length > 4 && arguments[4] !== void 0 ? arguments[4] : "", a = Object.keys(n).reduce(function(o, l) {
    var c = n[l];
    return typeof c == "function" && (c = c(i)), "".concat(o, " ").concat(l, '="').concat(c, '"');
  }, e);
  r += "<".concat(a, "></").concat(e, ">");
  var s = i + 1;
  return s < t ? createTagRepeat(e, t, n, s, r) : r;
}
function optimizeTemplateHTML(e) {
  return e.replace(/>\s+/g, ">").replace(/\s+</, "<");
}
function stripTime(e) {
  return new Date(e).setHours(0, 0, 0, 0);
}
function today() {
  return (/* @__PURE__ */ new Date()).setHours(0, 0, 0, 0);
}
function dateValue() {
  switch (arguments.length) {
    case 0:
      return today();
    case 1:
      return stripTime(arguments.length <= 0 ? void 0 : arguments[0]);
  }
  var e = /* @__PURE__ */ new Date(0);
  return e.setFullYear.apply(e, arguments), e.setHours(0, 0, 0, 0);
}
function addDays(e, t) {
  var n = new Date(e);
  return n.setDate(n.getDate() + t);
}
function addWeeks(e, t) {
  return addDays(e, t * 7);
}
function addMonths(e, t) {
  var n = new Date(e), i = n.getMonth() + t, r = i % 12;
  r < 0 && (r += 12);
  var a = n.setMonth(i);
  return n.getMonth() !== r ? n.setDate(0) : a;
}
function addYears(e, t) {
  var n = new Date(e), i = n.getMonth(), r = n.setFullYear(n.getFullYear() + t);
  return i === 1 && n.getMonth() === 2 ? n.setDate(0) : r;
}
function dayDiff(e, t) {
  return (e - t + 7) % 7;
}
function dayOfTheWeekOf(e, t) {
  var n = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : 0, i = new Date(e).getDay();
  return addDays(e, dayDiff(t, n) - dayDiff(i, n));
}
function getWeek(e) {
  var t = dayOfTheWeekOf(e, 4, 1), n = dayOfTheWeekOf(new Date(t).setMonth(0, 4), 4, 1);
  return Math.round((t - n) / 6048e5) + 1;
}
function startOfYearPeriod(e, t) {
  var n = new Date(e).getFullYear();
  return Math.floor(n / t) * t;
}
var reFormatTokens = /dd?|DD?|mm?|MM?|yy?(?:yy)?/, reNonDateParts = /[\s!-/:-@[-`{-~年月日]+/, knownFormats = {}, parseFns = {
  y: function(t, n) {
    return new Date(t).setFullYear(parseInt(n, 10));
  },
  m: function(t, n, i) {
    var r = new Date(t), a = parseInt(n, 10) - 1;
    if (isNaN(a)) {
      if (!n)
        return NaN;
      var s = n.toLowerCase(), o = function(c) {
        return c.toLowerCase().startsWith(s);
      };
      if (a = i.monthsShort.findIndex(o), a < 0 && (a = i.months.findIndex(o)), a < 0)
        return NaN;
    }
    return r.setMonth(a), r.getMonth() !== normalizeMonth(a) ? r.setDate(0) : r.getTime();
  },
  d: function(t, n) {
    return new Date(t).setDate(parseInt(n, 10));
  }
}, formatFns = {
  d: function(t) {
    return t.getDate();
  },
  dd: function(t) {
    return padZero(t.getDate(), 2);
  },
  D: function(t, n) {
    return n.daysShort[t.getDay()];
  },
  DD: function(t, n) {
    return n.days[t.getDay()];
  },
  m: function(t) {
    return t.getMonth() + 1;
  },
  mm: function(t) {
    return padZero(t.getMonth() + 1, 2);
  },
  M: function(t, n) {
    return n.monthsShort[t.getMonth()];
  },
  MM: function(t, n) {
    return n.months[t.getMonth()];
  },
  y: function(t) {
    return t.getFullYear();
  },
  yy: function(t) {
    return padZero(t.getFullYear(), 2).slice(-2);
  },
  yyyy: function(t) {
    return padZero(t.getFullYear(), 4);
  }
};
function normalizeMonth(e) {
  return e > -1 ? e % 12 : normalizeMonth(e + 12);
}
function padZero(e, t) {
  return e.toString().padStart(t, "0");
}
function parseFormatString(e) {
  if (typeof e != "string")
    throw new Error("Invalid date format.");
  if (e in knownFormats)
    return knownFormats[e];
  var t = e.split(reFormatTokens), n = e.match(new RegExp(reFormatTokens, "g"));
  if (t.length === 0 || !n)
    throw new Error("Invalid date format.");
  var i = n.map(function(a) {
    return formatFns[a];
  }), r = Object.keys(parseFns).reduce(function(a, s) {
    var o = n.find(function(l) {
      return l[0] !== "D" && l[0].toLowerCase() === s;
    });
    return o && a.push(s), a;
  }, []);
  return knownFormats[e] = {
    parser: function(s, o) {
      var l = s.split(reNonDateParts).reduce(function(c, u, d) {
        if (u.length > 0 && n[d]) {
          var h = n[d][0];
          h === "M" ? c.m = u : h !== "D" && (c[h] = u);
        }
        return c;
      }, {});
      return r.reduce(function(c, u) {
        var d = parseFns[u](c, l[u], o);
        return isNaN(d) ? c : d;
      }, today());
    },
    formatter: function(s, o) {
      var l = i.reduce(function(c, u, d) {
        return c += "".concat(t[d]).concat(u(s, o));
      }, "");
      return l += lastItemOf(t);
    }
  };
}
function parseDate(e, t, n) {
  if (e instanceof Date || typeof e == "number") {
    var i = stripTime(e);
    return isNaN(i) ? void 0 : i;
  }
  if (e) {
    if (e === "today")
      return today();
    if (t && t.toValue) {
      var r = t.toValue(e, t, n);
      return isNaN(r) ? void 0 : stripTime(r);
    }
    return parseFormatString(t).parser(e, n);
  }
}
function formatDate(e, t, n) {
  if (isNaN(e) || !e && e !== 0)
    return "";
  var i = typeof e == "number" ? new Date(e) : e;
  return t.toDisplay ? t.toDisplay(i, t, n) : parseFormatString(t).formatter(i, n);
}
var listenerRegistry = /* @__PURE__ */ new WeakMap(), _EventTarget$prototyp = EventTarget.prototype, addEventListener = _EventTarget$prototyp.addEventListener, removeEventListener = _EventTarget$prototyp.removeEventListener;
function registerListeners(e, t) {
  var n = listenerRegistry.get(e);
  n || (n = [], listenerRegistry.set(e, n)), t.forEach(function(i) {
    addEventListener.call.apply(addEventListener, _toConsumableArray(i)), n.push(i);
  });
}
function unregisterListeners(e) {
  var t = listenerRegistry.get(e);
  t && (t.forEach(function(n) {
    removeEventListener.call.apply(removeEventListener, _toConsumableArray(n));
  }), listenerRegistry.delete(e));
}
if (!Event.prototype.composedPath) {
  var getComposedPath = function e(t) {
    var n = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : [];
    n.push(t);
    var i;
    return t.parentNode ? i = t.parentNode : t.host ? i = t.host : t.defaultView && (i = t.defaultView), i ? e(i, n) : n;
  };
  Event.prototype.composedPath = function() {
    return getComposedPath(this.target);
  };
}
function findFromPath(e, t, n) {
  var i = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : 0, r = e[i];
  return t(r) ? r : r === n || !r.parentElement ? void 0 : findFromPath(e, t, n, i + 1);
}
function findElementInEventPath(e, t) {
  var n = typeof t == "function" ? t : function(i) {
    return i.matches(t);
  };
  return findFromPath(e.composedPath(), n, e.currentTarget);
}
var locales = {
  en: {
    days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    daysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    daysMin: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    today: "Today",
    clear: "Clear",
    titleFormat: "MM y"
  }
}, defaultOptions = {
  autohide: !1,
  beforeShowDay: null,
  beforeShowDecade: null,
  beforeShowMonth: null,
  beforeShowYear: null,
  calendarWeeks: !1,
  clearBtn: !1,
  dateDelimiter: ",",
  datesDisabled: [],
  daysOfWeekDisabled: [],
  daysOfWeekHighlighted: [],
  defaultViewDate: void 0,
  // placeholder, defaults to today() by the program
  disableTouchKeyboard: !1,
  format: "mm/dd/yyyy",
  language: "en",
  maxDate: null,
  maxNumberOfDates: 1,
  maxView: 3,
  minDate: null,
  nextArrow: '<svg class="w-4 h-4 rtl:rotate-180" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 10"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M1 5h12m0 0L9 1m4 4L9 9"/></svg>',
  orientation: "auto",
  pickLevel: 0,
  prevArrow: '<svg class="w-4 h-4 rtl:rotate-180" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 10"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5H1m0 0 4 4M1 5l4-4"/></svg>',
  showDaysOfWeek: !0,
  showOnClick: !0,
  showOnFocus: !0,
  startView: 0,
  title: "",
  todayBtn: !1,
  todayBtnMode: 0,
  todayHighlight: !1,
  updateOnBlur: !0,
  weekStart: 0
}, range = null;
function parseHTML(e) {
  return range == null && (range = document.createRange()), range.createContextualFragment(e);
}
function hideElement(e) {
  e.style.display !== "none" && (e.style.display && (e.dataset.styleDisplay = e.style.display), e.style.display = "none");
}
function showElement(e) {
  e.style.display === "none" && (e.dataset.styleDisplay ? (e.style.display = e.dataset.styleDisplay, delete e.dataset.styleDisplay) : e.style.display = "");
}
function emptyChildNodes(e) {
  e.firstChild && (e.removeChild(e.firstChild), emptyChildNodes(e));
}
function replaceChildNodes(e, t) {
  emptyChildNodes(e), t instanceof DocumentFragment ? e.appendChild(t) : typeof t == "string" ? e.appendChild(parseHTML(t)) : typeof t.forEach == "function" && t.forEach(function(n) {
    e.appendChild(n);
  });
}
var defaultLang = defaultOptions.language, defaultFormat = defaultOptions.format, defaultWeekStart = defaultOptions.weekStart;
function sanitizeDOW(e, t) {
  return e.length < 6 && t >= 0 && t < 7 ? pushUnique(e, t) : e;
}
function calcEndOfWeek(e) {
  return (e + 6) % 7;
}
function validateDate(e, t, n, i) {
  var r = parseDate(e, t, n);
  return r !== void 0 ? r : i;
}
function validateViewId(e, t) {
  var n = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : 3, i = parseInt(e, 10);
  return i >= 0 && i <= n ? i : t;
}
function processOptions(e, t) {
  var n = Object.assign({}, e), i = {}, r = t.constructor.locales, a = t.config || {}, s = a.format, o = a.language, l = a.locale, c = a.maxDate, u = a.maxView, d = a.minDate, h = a.pickLevel, b = a.startView, v = a.weekStart;
  if (n.language) {
    var x;
    if (n.language !== o && (r[n.language] ? x = n.language : (x = n.language.split("-")[0], r[x] === void 0 && (x = !1))), delete n.language, x) {
      o = i.language = x;
      var m = l || r[defaultLang];
      l = Object.assign({
        format: defaultFormat,
        weekStart: defaultWeekStart
      }, r[defaultLang]), o !== defaultLang && Object.assign(l, r[o]), i.locale = l, s === m.format && (s = i.format = l.format), v === m.weekStart && (v = i.weekStart = l.weekStart, i.weekEnd = calcEndOfWeek(l.weekStart));
    }
  }
  if (n.format) {
    var E = typeof n.format.toDisplay == "function", g = typeof n.format.toValue == "function", y = reFormatTokens.test(n.format);
    (E && g || y) && (s = i.format = n.format), delete n.format;
  }
  var f = d, p = c;
  if (n.minDate !== void 0 && (f = n.minDate === null ? dateValue(0, 0, 1) : validateDate(n.minDate, s, l, f), delete n.minDate), n.maxDate !== void 0 && (p = n.maxDate === null ? void 0 : validateDate(n.maxDate, s, l, p), delete n.maxDate), p < f ? (d = i.minDate = p, c = i.maxDate = f) : (d !== f && (d = i.minDate = f), c !== p && (c = i.maxDate = p)), n.datesDisabled && (i.datesDisabled = n.datesDisabled.reduce(function(R, H) {
    var I = parseDate(H, s, l);
    return I !== void 0 ? pushUnique(R, I) : R;
  }, []), delete n.datesDisabled), n.defaultViewDate !== void 0) {
    var _ = parseDate(n.defaultViewDate, s, l);
    _ !== void 0 && (i.defaultViewDate = _), delete n.defaultViewDate;
  }
  if (n.weekStart !== void 0) {
    var w = Number(n.weekStart) % 7;
    isNaN(w) || (v = i.weekStart = w, i.weekEnd = calcEndOfWeek(w)), delete n.weekStart;
  }
  if (n.daysOfWeekDisabled && (i.daysOfWeekDisabled = n.daysOfWeekDisabled.reduce(sanitizeDOW, []), delete n.daysOfWeekDisabled), n.daysOfWeekHighlighted && (i.daysOfWeekHighlighted = n.daysOfWeekHighlighted.reduce(sanitizeDOW, []), delete n.daysOfWeekHighlighted), n.maxNumberOfDates !== void 0) {
    var D = parseInt(n.maxNumberOfDates, 10);
    D >= 0 && (i.maxNumberOfDates = D, i.multidate = D !== 1), delete n.maxNumberOfDates;
  }
  n.dateDelimiter && (i.dateDelimiter = String(n.dateDelimiter), delete n.dateDelimiter);
  var A = h;
  n.pickLevel !== void 0 && (A = validateViewId(n.pickLevel, 2), delete n.pickLevel), A !== h && (h = i.pickLevel = A);
  var C = u;
  n.maxView !== void 0 && (C = validateViewId(n.maxView, u), delete n.maxView), C = h > C ? h : C, C !== u && (u = i.maxView = C);
  var S = b;
  if (n.startView !== void 0 && (S = validateViewId(n.startView, S), delete n.startView), S < h ? S = h : S > u && (S = u), S !== b && (i.startView = S), n.prevArrow) {
    var O = parseHTML(n.prevArrow);
    O.childNodes.length > 0 && (i.prevArrow = O.childNodes), delete n.prevArrow;
  }
  if (n.nextArrow) {
    var T = parseHTML(n.nextArrow);
    T.childNodes.length > 0 && (i.nextArrow = T.childNodes), delete n.nextArrow;
  }
  if (n.disableTouchKeyboard !== void 0 && (i.disableTouchKeyboard = "ontouchstart" in document && !!n.disableTouchKeyboard, delete n.disableTouchKeyboard), n.orientation) {
    var L = n.orientation.toLowerCase().split(/\s+/g);
    i.orientation = {
      x: L.find(function(R) {
        return R === "left" || R === "right";
      }) || "auto",
      y: L.find(function(R) {
        return R === "top" || R === "bottom";
      }) || "auto"
    }, delete n.orientation;
  }
  if (n.todayBtnMode !== void 0) {
    switch (n.todayBtnMode) {
      case 0:
      case 1:
        i.todayBtnMode = n.todayBtnMode;
    }
    delete n.todayBtnMode;
  }
  return Object.keys(n).forEach(function(R) {
    n[R] !== void 0 && hasProperty(defaultOptions, R) && (i[R] = n[R]);
  }), i;
}
var pickerTemplate = optimizeTemplateHTML(`<div class="datepicker hidden">
  <div class="datepicker-picker inline-block rounded-base bg-neutral-primary-medium border border-default-medium p-4">
    <div class="datepicker-header">
      <div class="datepicker-title bg-neutral-primary-medium text-heading px-2 py-3 text-center font-medium"></div>
      <div class="datepicker-controls flex justify-between mb-2">
        <button type="button" class="bg-neutral-primary-medium rounded-base text-body hover:bg-neutral-tertiary-medium hover:text-heading text-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-neutral-tertiary prev-btn"></button>
        <button type="button" class="text-sm rounded-base text-heading bg-neutral-primary-medium font-medium py-2.5 px-5 hover:bg-neutral-tertiary-medium focus:outline-none focus:ring-2 focus:ring-neutral-tertiary view-switch"></button>
        <button type="button" class="bg-neutral-primary-medium rounded-base text-body hover:bg-neutral-tertiary-medium hover:text-heading text-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-neutral-tertiary next-btn"></button>
      </div>
    </div>
    <div class="datepicker-main p-1"></div>
    <div class="datepicker-footer">
      <div class="datepicker-controls flex space-x-2 rtl:space-x-reverse mt-2">
        <button type="button" class="%buttonClass% today-btn text-white bg-brand hover:bg-brand-strong focus:ring-4 focus:ring-brand-medium font-medium rounded-base text-sm px-5 py-2 text-center w-1/2"></button>
        <button type="button" class="%buttonClass% clear-btn text-body bg-neutral-secondary-medium border border-default-medium hover:bg-neutral-tertiary-medium focus:ring-4 focus:ring-neutral-tertiary font-medium rounded-base text-sm px-5 py-2 text-center w-1/2"></button>
      </div>
    </div>
  </div>
</div>`), daysTemplate = optimizeTemplateHTML(`<div class="days">
  <div class="days-of-week grid grid-cols-7 mb-1">`.concat(createTagRepeat("span", 7, {
  class: "dow block flex-1 leading-9 border-0 rounded-base cursor-default text-center text-body font-medium text-sm"
}), `</div>
  <div class="datepicker-grid w-64 grid grid-cols-7">`).concat(createTagRepeat("span", 42, {
  class: "block flex-1 leading-9 border-0 rounded-base cursor-default text-center text-body font-medium text-sm h-6 leading-6 text-sm font-medium text-fg-disabled"
}), `</div>
</div>`)), calendarWeeksTemplate = optimizeTemplateHTML(`<div class="calendar-weeks">
  <div class="days-of-week flex"><span class="dow h-6 leading-6 text-sm font-medium text-fg-disabled"></span></div>
  <div class="weeks">`.concat(createTagRepeat("span", 6, {
  class: "week block flex-1 leading-9 border-0 rounded-base cursor-default text-center text-body font-medium text-sm"
}), `</div>
</div>`)), View = /* @__PURE__ */ (function() {
  function e(t, n) {
    _classCallCheck(this, e), Object.assign(this, n, {
      picker: t,
      element: parseHTML('<div class="datepicker-view flex"></div>').firstChild,
      selected: []
    }), this.init(this.picker.datepicker.config);
  }
  return _createClass(e, [{
    key: "init",
    value: function(n) {
      n.pickLevel !== void 0 && (this.isMinView = this.id === n.pickLevel), this.setOptions(n), this.updateFocus(), this.updateSelection();
    }
    // Execute beforeShow() callback and apply the result to the element
    // args:
    // - current - current value on the iteration on view rendering
    // - timeValue - time value of the date to pass to beforeShow()
  }, {
    key: "performBeforeHook",
    value: function(n, i, r) {
      var a = this.beforeShow(new Date(r));
      switch (_typeof(a)) {
        case "boolean":
          a = {
            enabled: a
          };
          break;
        case "string":
          a = {
            classes: a
          };
      }
      if (a) {
        if (a.enabled === !1 && (n.classList.add("disabled"), pushUnique(this.disabled, i)), a.classes) {
          var s, o = a.classes.split(/\s+/);
          (s = n.classList).add.apply(s, _toConsumableArray(o)), o.includes("disabled") && pushUnique(this.disabled, i);
        }
        a.content && replaceChildNodes(n, a.content);
      }
    }
  }]);
})(), DaysView = /* @__PURE__ */ (function(e) {
  function t(n) {
    return _classCallCheck(this, t), _callSuper(this, t, [n, {
      id: 0,
      name: "days",
      cellClass: "day"
    }]);
  }
  return _inherits(t, e), _createClass(t, [{
    key: "init",
    value: function(i) {
      var r = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : !0;
      if (r) {
        var a = parseHTML(daysTemplate).firstChild;
        this.dow = a.firstChild, this.grid = a.lastChild, this.element.appendChild(a);
      }
      _get(_getPrototypeOf(t.prototype), "init", this).call(this, i);
    }
  }, {
    key: "setOptions",
    value: function(i) {
      var r = this, a;
      if (hasProperty(i, "minDate") && (this.minDate = i.minDate), hasProperty(i, "maxDate") && (this.maxDate = i.maxDate), i.datesDisabled && (this.datesDisabled = i.datesDisabled), i.daysOfWeekDisabled && (this.daysOfWeekDisabled = i.daysOfWeekDisabled, a = !0), i.daysOfWeekHighlighted && (this.daysOfWeekHighlighted = i.daysOfWeekHighlighted), i.todayHighlight !== void 0 && (this.todayHighlight = i.todayHighlight), i.weekStart !== void 0 && (this.weekStart = i.weekStart, this.weekEnd = i.weekEnd, a = !0), i.locale) {
        var s = this.locale = i.locale;
        this.dayNames = s.daysMin, this.switchLabelFormat = s.titleFormat, a = !0;
      }
      if (i.beforeShowDay !== void 0 && (this.beforeShow = typeof i.beforeShowDay == "function" ? i.beforeShowDay : void 0), i.calendarWeeks !== void 0)
        if (i.calendarWeeks && !this.calendarWeeks) {
          var o = parseHTML(calendarWeeksTemplate).firstChild;
          this.calendarWeeks = {
            element: o,
            dow: o.firstChild,
            weeks: o.lastChild
          }, this.element.insertBefore(o, this.element.firstChild);
        } else this.calendarWeeks && !i.calendarWeeks && (this.element.removeChild(this.calendarWeeks.element), this.calendarWeeks = null);
      i.showDaysOfWeek !== void 0 && (i.showDaysOfWeek ? (showElement(this.dow), this.calendarWeeks && showElement(this.calendarWeeks.dow)) : (hideElement(this.dow), this.calendarWeeks && hideElement(this.calendarWeeks.dow))), a && Array.from(this.dow.children).forEach(function(l, c) {
        var u = (r.weekStart + c) % 7;
        l.textContent = r.dayNames[u], l.className = r.daysOfWeekDisabled.includes(u) ? "dow disabled text-center h-6 leading-6 text-sm font-medium text-fg-disabled cursor-not-allowed" : "dow text-center h-6 leading-6 text-sm font-medium text-body";
      });
    }
    // Apply update on the focused date to view's settings
  }, {
    key: "updateFocus",
    value: function() {
      var i = new Date(this.picker.viewDate), r = i.getFullYear(), a = i.getMonth(), s = dateValue(r, a, 1), o = dayOfTheWeekOf(s, this.weekStart, this.weekStart);
      this.first = s, this.last = dateValue(r, a + 1, 0), this.start = o, this.focused = this.picker.viewDate;
    }
    // Apply update on the selected dates to view's settings
  }, {
    key: "updateSelection",
    value: function() {
      var i = this.picker.datepicker, r = i.dates, a = i.rangepicker;
      this.selected = r, a && (this.range = a.dates);
    }
    // Update the entire view UI
  }, {
    key: "render",
    value: function() {
      var i = this;
      this.today = this.todayHighlight ? today() : void 0, this.disabled = _toConsumableArray(this.datesDisabled);
      var r = formatDate(this.focused, this.switchLabelFormat, this.locale);
      if (this.picker.setViewSwitchLabel(r), this.picker.setPrevBtnDisabled(this.first <= this.minDate), this.picker.setNextBtnDisabled(this.last >= this.maxDate), this.calendarWeeks) {
        var a = dayOfTheWeekOf(this.first, 1, 1);
        Array.from(this.calendarWeeks.weeks.children).forEach(function(s, o) {
          s.textContent = getWeek(addWeeks(a, o));
        });
      }
      Array.from(this.grid.children).forEach(function(s, o) {
        var l = s.classList, c = addDays(i.start, o), u = new Date(c), d = u.getDay();
        if (s.className = "datepicker-cell hover:bg-neutral-tertiary-medium block flex-1 leading-9 border-0 rounded-base cursor-pointer text-center text-body font-medium text-sm ".concat(i.cellClass), s.dataset.date = c, s.textContent = u.getDate(), c < i.first ? l.add("prev", "text-fg-disabled") : c > i.last && l.add("next", "text-fg-disabled"), i.today === c && l.add("today", "bg-gray-100", "dark:bg-gray-600"), (c < i.minDate || c > i.maxDate || i.disabled.includes(c)) && (l.add("disabled", "cursor-not-allowed", "text-fg-disabled"), l.remove("hover:bg-neutral-tertiary-medium", "text-body", "cursor-pointer")), i.daysOfWeekDisabled.includes(d) && (l.add("disabled", "cursor-not-allowed", "text-fg-disabled"), l.remove("hover:bg-neutral-tertiary-medium", "text-body", "cursor-pointer"), pushUnique(i.disabled, c)), i.daysOfWeekHighlighted.includes(d) && l.add("highlighted"), i.range) {
          var h = _slicedToArray(i.range, 2), b = h[0], v = h[1];
          c > b && c < v && (l.add("range", "bg-neutral-tertiary-medium"), l.remove("rounded-base", "rounded-s-base", "rounded-e-base")), c === b && (l.add("range-start", "bg-brand", "rounded-s-base"), l.remove("rounded-base", "rounded-e-base")), c === v && (l.add("range-end", "bg-neutral-tertiary-medium", "rounded-e-base"), l.remove("rounded-base", "rounded-s-base"));
        }
        i.selected.includes(c) && (l.add("selected", "bg-brand", "text-white"), l.remove("text-body", "hover:bg-neutral-tertiary-medium", "bg-neutral-tertiary-medium")), c === i.focused && l.add("focused"), i.beforeShow && i.performBeforeHook(s, c, c);
      });
    }
    // Update the view UI by applying the changes of selected and focused items
  }, {
    key: "refresh",
    value: function() {
      var i = this, r = this.range || [], a = _slicedToArray(r, 2), s = a[0], o = a[1];
      this.grid.querySelectorAll(".range, .range-start, .range-end, .selected, .focused").forEach(function(l) {
        l.classList.remove("range", "range-start", "range-end", "selected", "bg-brand", "text-white", "focused"), l.classList.add("text-body", "rounded-base");
      }), Array.from(this.grid.children).forEach(function(l) {
        var c = Number(l.dataset.date), u = l.classList;
        u.remove("bg-neutral-tertiary-medium", "rounded-s-base", "rounded-e-base"), c > s && c < o && (u.add("range", "bg-neutral-tertiary-medium"), u.remove("rounded-base")), c === s && (u.add("range-start", "bg-brand", "text-white", "rounded-s-base"), u.remove("rounded-base")), c === o && (u.add("range-end", "bg-neutral-tertiary-medium", "rounded-e-base"), u.remove("rounded-base")), i.selected.includes(c) && (u.add("selected", "bg-brand", "text-white"), u.remove("text-body", "hover:bg-neutral-tertiary-medium", "bg-neutral-tertiary-medium")), c === i.focused && u.add("focused");
      });
    }
    // Update the view UI by applying the change of focused item
  }, {
    key: "refreshFocus",
    value: function() {
      var i = Math.round((this.focused - this.start) / 864e5);
      this.grid.querySelectorAll(".focused").forEach(function(r) {
        r.classList.remove("focused");
      }), this.grid.children[i].classList.add("focused");
    }
  }]);
})(View);
function computeMonthRange(e, t) {
  if (!(!e || !e[0] || !e[1])) {
    var n = _slicedToArray(e, 2), i = _slicedToArray(n[0], 2), r = i[0], a = i[1], s = _slicedToArray(n[1], 2), o = s[0], l = s[1];
    if (!(r > t || o < t))
      return [r === t ? a : -1, o === t ? l : 12];
  }
}
var MonthsView = /* @__PURE__ */ (function(e) {
  function t(n) {
    return _classCallCheck(this, t), _callSuper(this, t, [n, {
      id: 1,
      name: "months",
      cellClass: "month"
    }]);
  }
  return _inherits(t, e), _createClass(t, [{
    key: "init",
    value: function(i) {
      var r = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : !0;
      r && (this.grid = this.element, this.element.classList.add("months", "datepicker-grid", "w-64", "grid", "grid-cols-4"), this.grid.appendChild(parseHTML(createTagRepeat("span", 12, {
        "data-month": function(s) {
          return s;
        }
      })))), _get(_getPrototypeOf(t.prototype), "init", this).call(this, i);
    }
  }, {
    key: "setOptions",
    value: function(i) {
      if (i.locale && (this.monthNames = i.locale.monthsShort), hasProperty(i, "minDate"))
        if (i.minDate === void 0)
          this.minYear = this.minMonth = this.minDate = void 0;
        else {
          var r = new Date(i.minDate);
          this.minYear = r.getFullYear(), this.minMonth = r.getMonth(), this.minDate = r.setDate(1);
        }
      if (hasProperty(i, "maxDate"))
        if (i.maxDate === void 0)
          this.maxYear = this.maxMonth = this.maxDate = void 0;
        else {
          var a = new Date(i.maxDate);
          this.maxYear = a.getFullYear(), this.maxMonth = a.getMonth(), this.maxDate = dateValue(this.maxYear, this.maxMonth + 1, 0);
        }
      i.beforeShowMonth !== void 0 && (this.beforeShow = typeof i.beforeShowMonth == "function" ? i.beforeShowMonth : void 0);
    }
    // Update view's settings to reflect the viewDate set on the picker
  }, {
    key: "updateFocus",
    value: function() {
      var i = new Date(this.picker.viewDate);
      this.year = i.getFullYear(), this.focused = i.getMonth();
    }
    // Update view's settings to reflect the selected dates
  }, {
    key: "updateSelection",
    value: function() {
      var i = this.picker.datepicker, r = i.dates, a = i.rangepicker;
      this.selected = r.reduce(function(s, o) {
        var l = new Date(o), c = l.getFullYear(), u = l.getMonth();
        return s[c] === void 0 ? s[c] = [u] : pushUnique(s[c], u), s;
      }, {}), a && a.dates && (this.range = a.dates.map(function(s) {
        var o = new Date(s);
        return isNaN(o) ? void 0 : [o.getFullYear(), o.getMonth()];
      }));
    }
    // Update the entire view UI
  }, {
    key: "render",
    value: function() {
      var i = this;
      this.disabled = [], this.picker.setViewSwitchLabel(this.year), this.picker.setPrevBtnDisabled(this.year <= this.minYear), this.picker.setNextBtnDisabled(this.year >= this.maxYear);
      var r = this.selected[this.year] || [], a = this.year < this.minYear || this.year > this.maxYear, s = this.year === this.minYear, o = this.year === this.maxYear, l = computeMonthRange(this.range, this.year);
      Array.from(this.grid.children).forEach(function(c, u) {
        var d = c.classList, h = dateValue(i.year, u, 1);
        if (c.className = "datepicker-cell hover:bg-neutral-tertiary-medium block flex-1 leading-9 border-0 rounded-base cursor-pointer text-center text-body font-medium text-sm ".concat(i.cellClass), i.isMinView && (c.dataset.date = h), c.textContent = i.monthNames[u], (a || s && u < i.minMonth || o && u > i.maxMonth) && d.add("disabled"), l) {
          var b = _slicedToArray(l, 2), v = b[0], x = b[1];
          u > v && u < x && d.add("range"), u === v && d.add("range-start"), u === x && d.add("range-end");
        }
        r.includes(u) && (d.add("selected", "bg-brand", "text-white", "dark:text-white"), d.remove("text-body", "hover:bg-neutral-tertiary-medium", "dark:text-white")), u === i.focused && d.add("focused"), i.beforeShow && i.performBeforeHook(c, u, h);
      });
    }
    // Update the view UI by applying the changes of selected and focused items
  }, {
    key: "refresh",
    value: function() {
      var i = this, r = this.selected[this.year] || [], a = computeMonthRange(this.range, this.year) || [], s = _slicedToArray(a, 2), o = s[0], l = s[1];
      this.grid.querySelectorAll(".range, .range-start, .range-end, .selected, .focused").forEach(function(c) {
        c.classList.remove("range", "range-start", "range-end", "selected", "bg-brand", "dark:text-white", "text-white", "focused"), c.classList.add("text-body", "hover:bg-neutral-tertiary-medium", "dark:text-white");
      }), Array.from(this.grid.children).forEach(function(c, u) {
        var d = c.classList;
        u > o && u < l && d.add("range"), u === o && d.add("range-start"), u === l && d.add("range-end"), r.includes(u) && (d.add("selected", "bg-brand", "text-white", "dark:text-white"), d.remove("text-body", "hover:bg-neutral-tertiary-medium", "dark:text-white")), u === i.focused && d.add("focused");
      });
    }
    // Update the view UI by applying the change of focused item
  }, {
    key: "refreshFocus",
    value: function() {
      this.grid.querySelectorAll(".focused").forEach(function(i) {
        i.classList.remove("focused");
      }), this.grid.children[this.focused].classList.add("focused");
    }
  }]);
})(View);
function toTitleCase(e) {
  return _toConsumableArray(e).reduce(function(t, n, i) {
    return t += i ? n : n.toUpperCase();
  }, "");
}
var YearsView = /* @__PURE__ */ (function(e) {
  function t(n, i) {
    return _classCallCheck(this, t), _callSuper(this, t, [n, i]);
  }
  return _inherits(t, e), _createClass(t, [{
    key: "init",
    value: function(i) {
      var r = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : !0;
      r && (this.navStep = this.step * 10, this.beforeShowOption = "beforeShow".concat(toTitleCase(this.cellClass)), this.grid = this.element, this.element.classList.add(this.name, "datepicker-grid", "w-64", "grid", "grid-cols-4"), this.grid.appendChild(parseHTML(createTagRepeat("span", 12)))), _get(_getPrototypeOf(t.prototype), "init", this).call(this, i);
    }
  }, {
    key: "setOptions",
    value: function(i) {
      if (hasProperty(i, "minDate") && (i.minDate === void 0 ? this.minYear = this.minDate = void 0 : (this.minYear = startOfYearPeriod(i.minDate, this.step), this.minDate = dateValue(this.minYear, 0, 1))), hasProperty(i, "maxDate") && (i.maxDate === void 0 ? this.maxYear = this.maxDate = void 0 : (this.maxYear = startOfYearPeriod(i.maxDate, this.step), this.maxDate = dateValue(this.maxYear, 11, 31))), i[this.beforeShowOption] !== void 0) {
        var r = i[this.beforeShowOption];
        this.beforeShow = typeof r == "function" ? r : void 0;
      }
    }
    // Update view's settings to reflect the viewDate set on the picker
  }, {
    key: "updateFocus",
    value: function() {
      var i = new Date(this.picker.viewDate), r = startOfYearPeriod(i, this.navStep), a = r + 9 * this.step;
      this.first = r, this.last = a, this.start = r - this.step, this.focused = startOfYearPeriod(i, this.step);
    }
    // Update view's settings to reflect the selected dates
  }, {
    key: "updateSelection",
    value: function() {
      var i = this, r = this.picker.datepicker, a = r.dates, s = r.rangepicker;
      this.selected = a.reduce(function(o, l) {
        return pushUnique(o, startOfYearPeriod(l, i.step));
      }, []), s && s.dates && (this.range = s.dates.map(function(o) {
        if (o !== void 0)
          return startOfYearPeriod(o, i.step);
      }));
    }
    // Update the entire view UI
  }, {
    key: "render",
    value: function() {
      var i = this;
      this.disabled = [], this.picker.setViewSwitchLabel("".concat(this.first, "-").concat(this.last)), this.picker.setPrevBtnDisabled(this.first <= this.minYear), this.picker.setNextBtnDisabled(this.last >= this.maxYear), Array.from(this.grid.children).forEach(function(r, a) {
        var s = r.classList, o = i.start + a * i.step, l = dateValue(o, 0, 1);
        if (r.className = "datepicker-cell hover:bg-neutral-tertiary-medium block flex-1 leading-9 border-0 rounded-base cursor-pointer text-center text-body font-medium text-sm ".concat(i.cellClass), i.isMinView && (r.dataset.date = l), r.textContent = r.dataset.year = o, a === 0 ? s.add("prev") : a === 11 && s.add("next"), (o < i.minYear || o > i.maxYear) && s.add("disabled"), i.range) {
          var c = _slicedToArray(i.range, 2), u = c[0], d = c[1];
          o > u && o < d && s.add("range"), o === u && s.add("range-start"), o === d && s.add("range-end");
        }
        i.selected.includes(o) && (s.add("selected", "bg-brand", "text-white", "dark:text-white"), s.remove("text-body", "hover:bg-neutral-tertiary-medium", "dark:text-white")), o === i.focused && s.add("focused"), i.beforeShow && i.performBeforeHook(r, o, l);
      });
    }
    // Update the view UI by applying the changes of selected and focused items
  }, {
    key: "refresh",
    value: function() {
      var i = this, r = this.range || [], a = _slicedToArray(r, 2), s = a[0], o = a[1];
      this.grid.querySelectorAll(".range, .range-start, .range-end, .selected, .focused").forEach(function(l) {
        l.classList.remove("range", "range-start", "range-end", "selected", "bg-brand", "text-white", "dark:text-white", "focused");
      }), Array.from(this.grid.children).forEach(function(l) {
        var c = Number(l.textContent), u = l.classList;
        c > s && c < o && u.add("range"), c === s && u.add("range-start"), c === o && u.add("range-end"), i.selected.includes(c) && (u.add("selected", "bg-brand", "text-white", "hover:text-heading"), u.remove("text-body", "hover:bg-neutral-tertiary-medium", "hover:text-heading")), c === i.focused && u.add("focused");
      });
    }
    // Update the view UI by applying the change of focused item
  }, {
    key: "refreshFocus",
    value: function() {
      var i = Math.round((this.focused - this.start) / this.step);
      this.grid.querySelectorAll(".focused").forEach(function(r) {
        r.classList.remove("focused");
      }), this.grid.children[i].classList.add("focused");
    }
  }]);
})(View);
function triggerDatepickerEvent(e, t) {
  var n = {
    date: e.getDate(),
    viewDate: new Date(e.picker.viewDate),
    viewId: e.picker.currentView.id,
    datepicker: e
  };
  e.element.dispatchEvent(new CustomEvent(t, {
    detail: n
  }));
}
function goToPrevOrNext(e, t) {
  var n = e.config, i = n.minDate, r = n.maxDate, a = e.picker, s = a.currentView, o = a.viewDate, l;
  switch (s.id) {
    case 0:
      l = addMonths(o, t);
      break;
    case 1:
      l = addYears(o, t);
      break;
    default:
      l = addYears(o, t * s.navStep);
  }
  l = limitToRange(l, i, r), e.picker.changeFocus(l).render();
}
function switchView(e) {
  var t = e.picker.currentView.id;
  t !== e.config.maxView && e.picker.changeView(t + 1).render();
}
function unfocus(e) {
  e.config.updateOnBlur ? e.update({
    autohide: !0
  }) : (e.refresh("input"), e.hide());
}
function goToSelectedMonthOrYear(e, t) {
  var n = e.picker, i = new Date(n.viewDate), r = n.currentView.id, a = r === 1 ? addMonths(i, t - i.getMonth()) : addYears(i, t - i.getFullYear());
  n.changeFocus(a).changeView(r - 1).render();
}
function onClickTodayBtn(e) {
  var t = e.picker, n = today();
  if (e.config.todayBtnMode === 1) {
    if (e.config.autohide) {
      e.setDate(n);
      return;
    }
    e.setDate(n, {
      render: !1
    }), t.update();
  }
  t.viewDate !== n && t.changeFocus(n), t.changeView(0).render();
}
function onClickClearBtn(e) {
  e.setDate({
    clear: !0
  });
}
function onClickViewSwitch(e) {
  switchView(e);
}
function onClickPrevBtn(e) {
  goToPrevOrNext(e, -1);
}
function onClickNextBtn(e) {
  goToPrevOrNext(e, 1);
}
function onClickView(e, t) {
  var n = findElementInEventPath(t, ".datepicker-cell");
  if (!(!n || n.classList.contains("disabled"))) {
    var i = e.picker.currentView, r = i.id, a = i.isMinView;
    a ? e.setDate(Number(n.dataset.date)) : r === 1 ? goToSelectedMonthOrYear(e, Number(n.dataset.month)) : goToSelectedMonthOrYear(e, Number(n.dataset.year));
  }
}
function onClickPicker(e) {
  !e.inline && !e.config.disableTouchKeyboard && e.inputField.focus();
}
function processPickerOptions(e, t) {
  if (t.title !== void 0 && (t.title ? (e.controls.title.textContent = t.title, showElement(e.controls.title)) : (e.controls.title.textContent = "", hideElement(e.controls.title))), t.prevArrow) {
    var n = e.controls.prevBtn;
    emptyChildNodes(n), t.prevArrow.forEach(function(o) {
      n.appendChild(o.cloneNode(!0));
    });
  }
  if (t.nextArrow) {
    var i = e.controls.nextBtn;
    emptyChildNodes(i), t.nextArrow.forEach(function(o) {
      i.appendChild(o.cloneNode(!0));
    });
  }
  if (t.locale && (e.controls.todayBtn.textContent = t.locale.today, e.controls.clearBtn.textContent = t.locale.clear), t.todayBtn !== void 0 && (t.todayBtn ? showElement(e.controls.todayBtn) : hideElement(e.controls.todayBtn)), hasProperty(t, "minDate") || hasProperty(t, "maxDate")) {
    var r = e.datepicker.config, a = r.minDate, s = r.maxDate;
    e.controls.todayBtn.disabled = !isInRange(today(), a, s);
  }
  t.clearBtn !== void 0 && (t.clearBtn ? showElement(e.controls.clearBtn) : hideElement(e.controls.clearBtn));
}
function computeResetViewDate(e) {
  var t = e.dates, n = e.config, i = t.length > 0 ? lastItemOf(t) : n.defaultViewDate;
  return limitToRange(i, n.minDate, n.maxDate);
}
function setViewDate(e, t) {
  var n = new Date(e.viewDate), i = new Date(t), r = e.currentView, a = r.id, s = r.year, o = r.first, l = r.last, c = i.getFullYear();
  switch (e.viewDate = t, c !== n.getFullYear() && triggerDatepickerEvent(e.datepicker, "changeYear"), i.getMonth() !== n.getMonth() && triggerDatepickerEvent(e.datepicker, "changeMonth"), a) {
    case 0:
      return t < o || t > l;
    case 1:
      return c !== s;
    default:
      return c < o || c > l;
  }
}
function getTextDirection(e) {
  return window.getComputedStyle(e).direction;
}
var Picker = /* @__PURE__ */ (function() {
  function e(t) {
    _classCallCheck(this, e), this.datepicker = t;
    var n = pickerTemplate.replace(/%buttonClass%/g, t.config.buttonClass), i = this.element = parseHTML(n).firstChild, r = _slicedToArray(i.firstChild.children, 3), a = r[0], s = r[1], o = r[2], l = a.firstElementChild, c = _slicedToArray(a.lastElementChild.children, 3), u = c[0], d = c[1], h = c[2], b = _slicedToArray(o.firstChild.children, 2), v = b[0], x = b[1], m = {
      title: l,
      prevBtn: u,
      viewSwitch: d,
      nextBtn: h,
      todayBtn: v,
      clearBtn: x
    };
    this.main = s, this.controls = m;
    var E = t.inline ? "inline" : "dropdown";
    i.classList.add("datepicker-".concat(E)), E === "dropdown" && i.classList.add("dropdown", "absolute", "top-0", "left-0", "z-50", "pt-2"), processPickerOptions(this, t.config), this.viewDate = computeResetViewDate(t), registerListeners(t, [[i, "click", onClickPicker.bind(null, t), {
      capture: !0
    }], [s, "click", onClickView.bind(null, t)], [m.viewSwitch, "click", onClickViewSwitch.bind(null, t)], [m.prevBtn, "click", onClickPrevBtn.bind(null, t)], [m.nextBtn, "click", onClickNextBtn.bind(null, t)], [m.todayBtn, "click", onClickTodayBtn.bind(null, t)], [m.clearBtn, "click", onClickClearBtn.bind(null, t)]]), this.views = [new DaysView(this), new MonthsView(this), new YearsView(this, {
      id: 2,
      name: "years",
      cellClass: "year",
      step: 1
    }), new YearsView(this, {
      id: 3,
      name: "decades",
      cellClass: "decade",
      step: 10
    })], this.currentView = this.views[t.config.startView], this.currentView.render(), this.main.appendChild(this.currentView.element), t.config.container.appendChild(this.element);
  }
  return _createClass(e, [{
    key: "setOptions",
    value: function(n) {
      processPickerOptions(this, n), this.views.forEach(function(i) {
        i.init(n, !1);
      }), this.currentView.render();
    }
  }, {
    key: "detach",
    value: function() {
      this.datepicker.config.container.removeChild(this.element);
    }
  }, {
    key: "show",
    value: function() {
      if (!this.active) {
        this.element.classList.add("active", "block"), this.element.classList.remove("hidden"), this.active = !0;
        var n = this.datepicker;
        if (!n.inline) {
          var i = getTextDirection(n.inputField);
          i !== getTextDirection(n.config.container) ? this.element.dir = i : this.element.dir && this.element.removeAttribute("dir"), this.place(), n.config.disableTouchKeyboard && n.inputField.blur();
        }
        triggerDatepickerEvent(n, "show");
      }
    }
  }, {
    key: "hide",
    value: function() {
      this.active && (this.datepicker.exitEditMode(), this.element.classList.remove("active", "block"), this.element.classList.add("active", "block", "hidden"), this.active = !1, triggerDatepickerEvent(this.datepicker, "hide"));
    }
  }, {
    key: "place",
    value: function() {
      var n = this.element, i = n.classList, r = n.style, a = this.datepicker, s = a.config, o = a.inputField, l = s.container, c = this.element.getBoundingClientRect(), u = c.width, d = c.height, h = l.getBoundingClientRect(), b = h.left, v = h.top, x = h.width, m = o.getBoundingClientRect(), E = m.left, g = m.top, y = m.width, f = m.height, p = s.orientation, _ = p.x, w = p.y, D, A, C;
      l === document.body ? (D = window.scrollY, A = E + window.scrollX, C = g + D) : (D = l.scrollTop, A = E - b, C = g - v + D), _ === "auto" && (A < 0 ? (_ = "left", A = 10) : A + u > x ? _ = "right" : _ = getTextDirection(o) === "rtl" ? "right" : "left"), _ === "right" && (A -= u - y), w === "auto" && (w = C - d < D ? "bottom" : "top"), w === "top" ? C -= d : C += f, i.remove("datepicker-orient-top", "datepicker-orient-bottom", "datepicker-orient-right", "datepicker-orient-left"), i.add("datepicker-orient-".concat(w), "datepicker-orient-".concat(_)), r.top = C && "".concat(C, "px"), r.left = A && "".concat(A, "px");
    }
  }, {
    key: "setViewSwitchLabel",
    value: function(n) {
      this.controls.viewSwitch.textContent = n;
    }
  }, {
    key: "setPrevBtnDisabled",
    value: function(n) {
      this.controls.prevBtn.disabled = n;
    }
  }, {
    key: "setNextBtnDisabled",
    value: function(n) {
      this.controls.nextBtn.disabled = n;
    }
  }, {
    key: "changeView",
    value: function(n) {
      var i = this.currentView, r = this.views[n];
      return r.id !== i.id && (this.currentView = r, this._renderMethod = "render", triggerDatepickerEvent(this.datepicker, "changeView"), this.main.replaceChild(r.element, i.element)), this;
    }
    // Change the focused date (view date)
  }, {
    key: "changeFocus",
    value: function(n) {
      return this._renderMethod = setViewDate(this, n) ? "render" : "refreshFocus", this.views.forEach(function(i) {
        i.updateFocus();
      }), this;
    }
    // Apply the change of the selected dates
  }, {
    key: "update",
    value: function() {
      var n = computeResetViewDate(this.datepicker);
      return this._renderMethod = setViewDate(this, n) ? "render" : "refresh", this.views.forEach(function(i) {
        i.updateFocus(), i.updateSelection();
      }), this;
    }
    // Refresh the picker UI
  }, {
    key: "render",
    value: function() {
      var n = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : !0, i = n && this._renderMethod || "render";
      delete this._renderMethod, this.currentView[i]();
    }
  }]);
})();
function findNextAvailableOne(e, t, n, i, r, a) {
  if (isInRange(e, r, a)) {
    if (i(e)) {
      var s = t(e, n);
      return findNextAvailableOne(s, t, n, i, r, a);
    }
    return e;
  }
}
function moveByArrowKey(e, t, n, i) {
  var r = e.picker, a = r.currentView, s = a.step || 1, o = r.viewDate, l, c;
  switch (a.id) {
    case 0:
      i ? o = addDays(o, n * 7) : t.ctrlKey || t.metaKey ? o = addYears(o, n) : o = addDays(o, n), l = addDays, c = function(d) {
        return a.disabled.includes(d);
      };
      break;
    case 1:
      o = addMonths(o, i ? n * 4 : n), l = addMonths, c = function(d) {
        var h = new Date(d), b = a.year, v = a.disabled;
        return h.getFullYear() === b && v.includes(h.getMonth());
      };
      break;
    default:
      o = addYears(o, n * (i ? 4 : 1) * s), l = addYears, c = function(d) {
        return a.disabled.includes(startOfYearPeriod(d, s));
      };
  }
  o = findNextAvailableOne(o, l, n < 0 ? -s : s, c, a.minDate, a.maxDate), o !== void 0 && r.changeFocus(o).render();
}
function onKeydown(e, t) {
  if (t.key === "Tab") {
    unfocus(e);
    return;
  }
  var n = e.picker, i = n.currentView, r = i.id, a = i.isMinView;
  if (n.active)
    if (e.editMode)
      switch (t.key) {
        case "Escape":
          n.hide();
          break;
        case "Enter":
          e.exitEditMode({
            update: !0,
            autohide: e.config.autohide
          });
          break;
        default:
          return;
      }
    else
      switch (t.key) {
        case "Escape":
          n.hide();
          break;
        case "ArrowLeft":
          if (t.ctrlKey || t.metaKey)
            goToPrevOrNext(e, -1);
          else if (t.shiftKey) {
            e.enterEditMode();
            return;
          } else
            moveByArrowKey(e, t, -1, !1);
          break;
        case "ArrowRight":
          if (t.ctrlKey || t.metaKey)
            goToPrevOrNext(e, 1);
          else if (t.shiftKey) {
            e.enterEditMode();
            return;
          } else
            moveByArrowKey(e, t, 1, !1);
          break;
        case "ArrowUp":
          if (t.ctrlKey || t.metaKey)
            switchView(e);
          else if (t.shiftKey) {
            e.enterEditMode();
            return;
          } else
            moveByArrowKey(e, t, -1, !0);
          break;
        case "ArrowDown":
          if (t.shiftKey && !t.ctrlKey && !t.metaKey) {
            e.enterEditMode();
            return;
          }
          moveByArrowKey(e, t, 1, !0);
          break;
        case "Enter":
          a ? e.setDate(n.viewDate) : n.changeView(r - 1).render();
          break;
        case "Backspace":
        case "Delete":
          e.enterEditMode();
          return;
        default:
          t.key.length === 1 && !t.ctrlKey && !t.metaKey && e.enterEditMode();
          return;
      }
  else switch (t.key) {
    case "ArrowDown":
    case "Escape":
      n.show();
      break;
    case "Enter":
      e.update();
      break;
    default:
      return;
  }
  t.preventDefault(), t.stopPropagation();
}
function onFocus(e) {
  e.config.showOnFocus && !e._showing && e.show();
}
function onMousedown(e, t) {
  var n = t.target;
  (e.picker.active || e.config.showOnClick) && (n._active = n === document.activeElement, n._clicking = setTimeout(function() {
    delete n._active, delete n._clicking;
  }, 2e3));
}
function onClickInput(e, t) {
  var n = t.target;
  n._clicking && (clearTimeout(n._clicking), delete n._clicking, n._active && e.enterEditMode(), delete n._active, e.config.showOnClick && e.show());
}
function onPaste(e, t) {
  t.clipboardData.types.includes("text/plain") && e.enterEditMode();
}
function onClickOutside(e, t) {
  var n = e.element;
  if (n === document.activeElement) {
    var i = e.picker.element;
    findElementInEventPath(t, function(r) {
      return r === n || r === i;
    }) || unfocus(e);
  }
}
function stringifyDates(e, t) {
  return e.map(function(n) {
    return formatDate(n, t.format, t.locale);
  }).join(t.dateDelimiter);
}
function processInputDates(e, t) {
  var n = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1, i = e.config, r = e.dates, a = e.rangepicker;
  if (t.length === 0)
    return n ? [] : void 0;
  var s = a && e === a.datepickers[1], o = t.reduce(function(l, c) {
    var u = parseDate(c, i.format, i.locale);
    if (u === void 0)
      return l;
    if (i.pickLevel > 0) {
      var d = new Date(u);
      i.pickLevel === 1 ? u = s ? d.setMonth(d.getMonth() + 1, 0) : d.setDate(1) : u = s ? d.setFullYear(d.getFullYear() + 1, 0, 0) : d.setMonth(0, 1);
    }
    return isInRange(u, i.minDate, i.maxDate) && !l.includes(u) && !i.datesDisabled.includes(u) && !i.daysOfWeekDisabled.includes(new Date(u).getDay()) && l.push(u), l;
  }, []);
  if (o.length !== 0)
    return i.multidate && !n && (o = o.reduce(function(l, c) {
      return r.includes(c) || l.push(c), l;
    }, r.filter(function(l) {
      return !o.includes(l);
    }))), i.maxNumberOfDates && o.length > i.maxNumberOfDates ? o.slice(i.maxNumberOfDates * -1) : o;
}
function refreshUI(e) {
  var t = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 3, n = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !0, i = e.config, r = e.picker, a = e.inputField;
  if (t & 2) {
    var s = r.active ? i.pickLevel : i.startView;
    r.update().changeView(s).render(n);
  }
  t & 1 && a && (a.value = stringifyDates(e.dates, i));
}
function _setDate(e, t, n) {
  var i = n.clear, r = n.render, a = n.autohide;
  r === void 0 && (r = !0), r ? a === void 0 && (a = e.config.autohide) : a = !1;
  var s = processInputDates(e, t, i);
  s && (s.toString() !== e.dates.toString() ? (e.dates = s, refreshUI(e, r ? 3 : 1), triggerDatepickerEvent(e, "changeDate")) : refreshUI(e, 1), a && e.hide());
}
var Datepicker$1 = /* @__PURE__ */ (function() {
  function e(t) {
    var n = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {}, i = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : void 0;
    _classCallCheck(this, e), t.datepicker = this, this.element = t;
    var r = this.config = Object.assign({
      buttonClass: n.buttonClass && String(n.buttonClass) || "button",
      container: document.body,
      defaultViewDate: today(),
      maxDate: void 0,
      minDate: void 0
    }, processOptions(defaultOptions, this));
    this._options = n, Object.assign(r, processOptions(n, this));
    var a = this.inline = t.tagName !== "INPUT", s, o;
    if (a)
      r.container = t, o = stringToArray(t.dataset.date, r.dateDelimiter), delete t.dataset.date;
    else {
      var l = n.container ? document.querySelector(n.container) : null;
      l && (r.container = l), s = this.inputField = t, s.classList.add("datepicker-input"), o = stringToArray(s.value, r.dateDelimiter);
    }
    if (i) {
      var c = i.inputs.indexOf(s), u = i.datepickers;
      if (c < 0 || c > 1 || !Array.isArray(u))
        throw Error("Invalid rangepicker object.");
      u[c] = this, Object.defineProperty(this, "rangepicker", {
        get: function() {
          return i;
        }
      });
    }
    this.dates = [];
    var d = processInputDates(this, o);
    d && d.length > 0 && (this.dates = d), s && (s.value = stringifyDates(this.dates, r));
    var h = this.picker = new Picker(this);
    if (a)
      this.show();
    else {
      var b = onClickOutside.bind(null, this), v = [[s, "keydown", onKeydown.bind(null, this)], [s, "focus", onFocus.bind(null, this)], [s, "mousedown", onMousedown.bind(null, this)], [s, "click", onClickInput.bind(null, this)], [s, "paste", onPaste.bind(null, this)], [document, "mousedown", b], [document, "touchstart", b], [window, "resize", h.place.bind(h)]];
      registerListeners(this, v);
    }
  }
  return _createClass(e, [{
    key: "active",
    get: (
      /**
       * @type {Boolean} - Whether the picker element is shown. `true` whne shown
       */
      function() {
        return !!(this.picker && this.picker.active);
      }
    )
    /**
     * @type {HTMLDivElement} - DOM object of picker element
     */
  }, {
    key: "pickerElement",
    get: function() {
      return this.picker ? this.picker.element : void 0;
    }
    /**
     * Set new values to the config options
     * @param {Object} options - config options to update
     */
  }, {
    key: "setOptions",
    value: function(n) {
      var i = this.picker, r = processOptions(n, this);
      Object.assign(this._options, n), Object.assign(this.config, r), i.setOptions(r), refreshUI(this, 3);
    }
    /**
     * Show the picker element
     */
  }, {
    key: "show",
    value: function() {
      if (this.inputField) {
        if (this.inputField.disabled)
          return;
        this.inputField !== document.activeElement && (this._showing = !0, this.inputField.focus(), delete this._showing);
      }
      this.picker.show();
    }
    /**
     * Hide the picker element
     * Not available on inline picker
     */
  }, {
    key: "hide",
    value: function() {
      this.inline || (this.picker.hide(), this.picker.update().changeView(this.config.startView).render());
    }
    /**
     * Destroy the Datepicker instance
     * @return {Detepicker} - the instance destroyed
     */
  }, {
    key: "destroy",
    value: function() {
      return this.hide(), unregisterListeners(this), this.picker.detach(), this.inline || this.inputField.classList.remove("datepicker-input"), delete this.element.datepicker, this;
    }
    /**
     * Get the selected date(s)
     *
     * The method returns a Date object of selected date by default, and returns
     * an array of selected dates in multidate mode. If format string is passed,
     * it returns date string(s) formatted in given format.
     *
     * @param  {String} [format] - Format string to stringify the date(s)
     * @return {Date|String|Date[]|String[]} - selected date(s), or if none is
     * selected, empty array in multidate mode and untitled in sigledate mode
     */
  }, {
    key: "getDate",
    value: function() {
      var n = this, i = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : void 0, r = i ? function(a) {
        return formatDate(a, i, n.config.locale);
      } : function(a) {
        return new Date(a);
      };
      if (this.config.multidate)
        return this.dates.map(r);
      if (this.dates.length > 0)
        return r(this.dates[0]);
    }
    /**
     * Set selected date(s)
     *
     * In multidate mode, you can pass multiple dates as a series of arguments
     * or an array. (Since each date is parsed individually, the type of the
     * dates doesn't have to be the same.)
     * The given dates are used to toggle the select status of each date. The
     * number of selected dates is kept from exceeding the length set to
     * maxNumberOfDates.
     *
     * With clear: true option, the method can be used to clear the selection
     * and to replace the selection instead of toggling in multidate mode.
     * If the option is passed with no date arguments or an empty dates array,
     * it works as "clear" (clear the selection then set nothing), and if the
     * option is passed with new dates to select, it works as "replace" (clear
     * the selection then set the given dates)
     *
     * When render: false option is used, the method omits re-rendering the
     * picker element. In this case, you need to call refresh() method later in
     * order for the picker element to reflect the changes. The input field is
     * refreshed always regardless of this option.
     *
     * When invalid (unparsable, repeated, disabled or out-of-range) dates are
     * passed, the method ignores them and applies only valid ones. In the case
     * that all the given dates are invalid, which is distinguished from passing
     * no dates, the method considers it as an error and leaves the selection
     * untouched.
     *
     * @param {...(Date|Number|String)|Array} [dates] - Date strings, Date
     * objects, time values or mix of those for new selection
     * @param {Object} [options] - function options
     * - clear: {boolean} - Whether to clear the existing selection
     *     defualt: false
     * - render: {boolean} - Whether to re-render the picker element
     *     default: true
     * - autohide: {boolean} - Whether to hide the picker element after re-render
     *     Ignored when used with render: false
     *     default: config.autohide
     */
  }, {
    key: "setDate",
    value: function() {
      for (var n = arguments.length, i = new Array(n), r = 0; r < n; r++)
        i[r] = arguments[r];
      var a = [].concat(i), s = {}, o = lastItemOf(i);
      _typeof(o) === "object" && !Array.isArray(o) && !(o instanceof Date) && o && Object.assign(s, a.pop());
      var l = Array.isArray(a[0]) ? a[0] : a;
      _setDate(this, l, s);
    }
    /**
     * Update the selected date(s) with input field's value
     * Not available on inline picker
     *
     * The input field will be refreshed with properly formatted date string.
     *
     * @param  {Object} [options] - function options
     * - autohide: {boolean} - whether to hide the picker element after refresh
     *     default: false
     */
  }, {
    key: "update",
    value: function() {
      var n = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : void 0;
      if (!this.inline) {
        var i = {
          clear: !0,
          autohide: !!(n && n.autohide)
        }, r = stringToArray(this.inputField.value, this.config.dateDelimiter);
        _setDate(this, r, i);
      }
    }
    /**
     * Refresh the picker element and the associated input field
     * @param {String} [target] - target item when refreshing one item only
     * 'picker' or 'input'
     * @param {Boolean} [forceRender] - whether to re-render the picker element
     * regardless of its state instead of optimized refresh
     */
  }, {
    key: "refresh",
    value: function() {
      var n = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : void 0, i = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : !1;
      n && typeof n != "string" && (i = n, n = void 0);
      var r;
      n === "picker" ? r = 2 : n === "input" ? r = 1 : r = 3, refreshUI(this, r, !i);
    }
    /**
     * Enter edit mode
     * Not available on inline picker or when the picker element is hidden
     */
  }, {
    key: "enterEditMode",
    value: function() {
      this.inline || !this.picker.active || this.editMode || (this.editMode = !0, this.inputField.classList.add("in-edit", "border-brand"));
    }
    /**
     * Exit from edit mode
     * Not available on inline picker
     * @param  {Object} [options] - function options
     * - update: {boolean} - whether to call update() after exiting
     *     If false, input field is revert to the existing selection
     *     default: false
     */
  }, {
    key: "exitEditMode",
    value: function() {
      var n = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : void 0;
      if (!(this.inline || !this.editMode)) {
        var i = Object.assign({
          update: !1
        }, n);
        delete this.editMode, this.inputField.classList.remove("in-edit", "border-brand"), i.update && this.update(i);
      }
    }
  }], [{
    key: "formatDate",
    value: function(n, i, r) {
      return formatDate(n, i, r && locales[r] || locales.en);
    }
    /**
     * Parse date string
     * @param  {String|Date|Number} dateStr - date string, Date object or time
     * value to parse
     * @param  {String|Object} format - format string or object that contains
     * toValue() custom parser, whose signature is
     * - args:
     *   - dateStr: {String|Date|Number} - the dateStr passed to the method
     *   - format: {Object} - the format object passed to the method
     *   - locale: {Object} - locale for the language specified by `lang`
     * - return:
     *     {Date|Number} parsed date or its time value
     * @param  {String} [lang=en] - language code for the locale to use
     * @return {Number} time value of parsed date
     */
  }, {
    key: "parseDate",
    value: function(n, i, r) {
      return parseDate(n, i, r && locales[r] || locales.en);
    }
    /**
     * @type {Object} - Installed locales in `[languageCode]: localeObject` format
     * en`:_English (US)_ is pre-installed.
     */
  }, {
    key: "locales",
    get: function() {
      return locales;
    }
  }]);
})();
function filterOptions(e) {
  var t = Object.assign({}, e);
  return delete t.inputs, delete t.allowOneSidedRange, delete t.maxNumberOfDates, t;
}
function setupDatepicker(e, t, n, i) {
  registerListeners(e, [[n, "changeDate", t]]), new Datepicker$1(n, i, e);
}
function onChangeDate(e, t) {
  if (!e._updating) {
    e._updating = !0;
    var n = t.target;
    if (n.datepicker !== void 0) {
      var i = e.datepickers, r = {
        render: !1
      }, a = e.inputs.indexOf(n), s = a === 0 ? 1 : 0, o = i[a].dates[0], l = i[s].dates[0];
      o !== void 0 && l !== void 0 ? a === 0 && o > l ? (i[0].setDate(l, r), i[1].setDate(o, r)) : a === 1 && o < l && (i[0].setDate(o, r), i[1].setDate(l, r)) : e.allowOneSidedRange || (o !== void 0 || l !== void 0) && (r.clear = !0, i[s].setDate(i[a].dates, r)), i[0].picker.update().render(), i[1].picker.update().render(), delete e._updating;
    }
  }
}
var DateRangePicker = /* @__PURE__ */ (function() {
  function e(t) {
    var n = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    _classCallCheck(this, e);
    var i = Array.isArray(n.inputs) ? n.inputs : Array.from(t.querySelectorAll("input"));
    if (!(i.length < 2)) {
      t.rangepicker = this, this.element = t, this.inputs = i.slice(0, 2), this.allowOneSidedRange = !!n.allowOneSidedRange;
      var r = onChangeDate.bind(null, this), a = filterOptions(n), s = [];
      Object.defineProperty(this, "datepickers", {
        get: function() {
          return s;
        }
      }), setupDatepicker(this, r, this.inputs[0], a), setupDatepicker(this, r, this.inputs[1], a), Object.freeze(s), s[0].dates.length > 0 ? onChangeDate(this, {
        target: this.inputs[0]
      }) : s[1].dates.length > 0 && onChangeDate(this, {
        target: this.inputs[1]
      });
    }
  }
  return _createClass(e, [{
    key: "dates",
    get: function() {
      return this.datepickers.length === 2 ? [this.datepickers[0].dates[0], this.datepickers[1].dates[0]] : void 0;
    }
    /**
     * Set new values to the config options
     * @param {Object} options - config options to update
     */
  }, {
    key: "setOptions",
    value: function(n) {
      this.allowOneSidedRange = !!n.allowOneSidedRange;
      var i = filterOptions(n);
      this.datepickers[0].setOptions(i), this.datepickers[1].setOptions(i);
    }
    /**
     * Destroy the DateRangePicker instance
     * @return {DateRangePicker} - the instance destroyed
     */
  }, {
    key: "destroy",
    value: function() {
      this.datepickers[0].destroy(), this.datepickers[1].destroy(), unregisterListeners(this), delete this.element.rangepicker;
    }
    /**
     * Get the start and end dates of the date range
     *
     * The method returns Date objects by default. If format string is passed,
     * it returns date strings formatted in given format.
     * The result array always contains 2 items (start date/end date) and
     * undefined is used for unselected side. (e.g. If none is selected,
     * the result will be [undefined, undefined]. If only the end date is set
     * when allowOneSidedRange config option is true, [undefined, endDate] will
     * be returned.)
     *
     * @param  {String} [format] - Format string to stringify the dates
     * @return {Array} - Start and end dates
     */
  }, {
    key: "getDates",
    value: function() {
      var n = this, i = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : void 0, r = i ? function(a) {
        return formatDate(a, i, n.datepickers[0].config.locale);
      } : function(a) {
        return new Date(a);
      };
      return this.dates.map(function(a) {
        return a === void 0 ? a : r(a);
      });
    }
    /**
     * Set the start and end dates of the date range
     *
     * The method calls datepicker.setDate() internally using each of the
     * arguments in start→end order.
     *
     * When a clear: true option object is passed instead of a date, the method
     * clears the date.
     *
     * If an invalid date, the same date as the current one or an option object
     * without clear: true is passed, the method considers that argument as an
     * "ineffective" argument because calling datepicker.setDate() with those
     * values makes no changes to the date selection.
     *
     * When the allowOneSidedRange config option is false, passing {clear: true}
     * to clear the range works only when it is done to the last effective
     * argument (in other words, passed to rangeEnd or to rangeStart along with
     * ineffective rangeEnd). This is because when the date range is changed,
     * it gets normalized based on the last change at the end of the changing
     * process.
     *
     * @param {Date|Number|String|Object} rangeStart - Start date of the range
     * or {clear: true} to clear the date
     * @param {Date|Number|String|Object} rangeEnd - End date of the range
     * or {clear: true} to clear the date
     */
  }, {
    key: "setDates",
    value: function(n, i) {
      var r = _slicedToArray(this.datepickers, 2), a = r[0], s = r[1], o = this.dates;
      this._updating = !0, a.setDate(n), s.setDate(i), delete this._updating, s.dates[0] !== o[1] ? onChangeDate(this, {
        target: this.inputs[1]
      }) : a.dates[0] !== o[0] && onChangeDate(this, {
        target: this.inputs[0]
      });
    }
  }]);
})(), __assign = function() {
  return __assign = Object.assign || function(e) {
    for (var t, n = 1, i = arguments.length; n < i; n++) {
      t = arguments[n];
      for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
    }
    return e;
  }, __assign.apply(this, arguments);
}, Default = {
  defaultDatepickerId: null,
  autohide: !1,
  format: "mm/dd/yyyy",
  maxDate: null,
  minDate: null,
  orientation: "bottom",
  buttons: !1,
  autoSelectToday: 0,
  title: null,
  language: "en",
  rangePicker: !1,
  onShow: function() {
  },
  onHide: function() {
  }
}, DefaultInstanceOptions = {
  id: null,
  override: !0
}, Datepicker = (
  /** @class */
  (function() {
    function e(t, n, i) {
      t === void 0 && (t = null), n === void 0 && (n = Default), i === void 0 && (i = DefaultInstanceOptions), this._instanceId = i.id ? i.id : t.id, this._datepickerEl = t, this._datepickerInstance = null, this._options = __assign(__assign({}, Default), n), this._initialized = !1, this.init(), instances.addInstance("Datepicker", this, this._instanceId, i.override);
    }
    return e.prototype.init = function() {
      this._datepickerEl && !this._initialized && (this._options.rangePicker ? this._datepickerInstance = new DateRangePicker(this._datepickerEl, this._getDatepickerOptions(this._options)) : this._datepickerInstance = new Datepicker$1(this._datepickerEl, this._getDatepickerOptions(this._options)), this._initialized = !0);
    }, e.prototype.destroy = function() {
      this._initialized && (this._initialized = !1, this._datepickerInstance.destroy());
    }, e.prototype.removeInstance = function() {
      this.destroy(), instances.removeInstance("Datepicker", this._instanceId);
    }, e.prototype.destroyAndRemoveInstance = function() {
      this.destroy(), this.removeInstance();
    }, e.prototype.getDatepickerInstance = function() {
      return this._datepickerInstance;
    }, e.prototype.getDate = function() {
      if (this._options.rangePicker && this._datepickerInstance instanceof DateRangePicker)
        return this._datepickerInstance.getDates();
      if (!this._options.rangePicker && this._datepickerInstance instanceof Datepicker$1)
        return this._datepickerInstance.getDate();
    }, e.prototype.setDate = function(t) {
      if (this._options.rangePicker && this._datepickerInstance instanceof DateRangePicker)
        return this._datepickerInstance.setDates(t);
      if (!this._options.rangePicker && this._datepickerInstance instanceof Datepicker$1)
        return this._datepickerInstance.setDate(t);
    }, e.prototype.show = function() {
      this._datepickerInstance.show(), this._options.onShow(this);
    }, e.prototype.hide = function() {
      this._datepickerInstance.hide(), this._options.onHide(this);
    }, e.prototype._getDatepickerOptions = function(t) {
      var n = {};
      return t.buttons && (n.todayBtn = !0, n.clearBtn = !0, t.autoSelectToday && (n.todayBtnMode = 1)), t.autohide && (n.autohide = !0), t.format && (n.format = t.format), t.maxDate && (n.maxDate = t.maxDate), t.minDate && (n.minDate = t.minDate), t.orientation && (n.orientation = t.orientation), t.title && (n.title = t.title), t.language && (n.language = t.language), n;
    }, e.prototype.updateOnShow = function(t) {
      this._options.onShow = t;
    }, e.prototype.updateOnHide = function(t) {
      this._options.onHide = t;
    }, e;
  })()
);
function initDatepickers() {
  document.querySelectorAll("[datepicker], [inline-datepicker], [date-rangepicker]").forEach(function(e) {
    if (e) {
      var t = e.hasAttribute("datepicker-buttons"), n = e.hasAttribute("datepicker-autoselect-today"), i = e.hasAttribute("datepicker-autohide"), r = e.getAttribute("datepicker-format"), a = e.getAttribute("datepicker-max-date"), s = e.getAttribute("datepicker-min-date"), o = e.getAttribute("datepicker-orientation"), l = e.getAttribute("datepicker-title"), c = e.getAttribute("datepicker-language"), u = e.hasAttribute("date-rangepicker");
      new Datepicker(e, {
        buttons: t || Default.buttons,
        autoSelectToday: n || Default.autoSelectToday,
        autohide: i || Default.autohide,
        format: r || Default.format,
        maxDate: a || Default.maxDate,
        minDate: s || Default.minDate,
        orientation: o || Default.orientation,
        title: l || Default.title,
        language: c || Default.language,
        rangePicker: u || Default.rangePicker
      });
    } else
      console.error("The datepicker element does not exist. Please check the datepicker attribute.");
  });
}
typeof window < "u" && (window.Datepicker = Datepicker, window.initDatepickers = initDatepickers);
function initFlowbite() {
  initAccordions(), initCollapses(), initCarousels(), initDismisses(), initDropdowns(), initModals(), initDrawers(), initTabs(), initTooltips(), initPopovers(), initDials(), initInputCounters(), initCopyClipboards(), initDatepickers();
}
typeof window < "u" && (window.initFlowbite = initFlowbite);
var events = new Events("load", [
  initAccordions,
  initCollapses,
  initCarousels,
  initDismisses,
  initDropdowns,
  initModals,
  initDrawers,
  initTabs,
  initTooltips,
  initPopovers,
  initDials,
  initInputCounters,
  initCopyClipboards,
  initDatepickers
]);
events.init();
var htmx = (function() {
  const htmx = {
    // Tsc madness here, assigning the functions directly results in an invalid TypeScript output, but reassigning is fine
    /* Event processing */
    /** @type {typeof onLoadHelper} */
    onLoad: null,
    /** @type {typeof processNode} */
    process: null,
    /** @type {typeof addEventListenerImpl} */
    on: null,
    /** @type {typeof removeEventListenerImpl} */
    off: null,
    /** @type {typeof triggerEvent} */
    trigger: null,
    /** @type {typeof ajaxHelper} */
    ajax: null,
    /* DOM querying helpers */
    /** @type {typeof find} */
    find: null,
    /** @type {typeof findAll} */
    findAll: null,
    /** @type {typeof closest} */
    closest: null,
    /**
     * Returns the input values that would resolve for a given element via the htmx value resolution mechanism
     *
     * @see https://htmx.org/api/#values
     *
     * @param {Element} elt the element to resolve values on
     * @param {HttpVerb} type the request type (e.g. **get** or **post**) non-GET's will include the enclosing form of the element. Defaults to **post**
     * @returns {Object}
     */
    values: function(e, t) {
      return getInputValues(e, t || "post").values;
    },
    /* DOM manipulation helpers */
    /** @type {typeof removeElement} */
    remove: null,
    /** @type {typeof addClassToElement} */
    addClass: null,
    /** @type {typeof removeClassFromElement} */
    removeClass: null,
    /** @type {typeof toggleClassOnElement} */
    toggleClass: null,
    /** @type {typeof takeClassForElement} */
    takeClass: null,
    /** @type {typeof swap} */
    swap: null,
    /* Extension entrypoints */
    /** @type {typeof defineExtension} */
    defineExtension: null,
    /** @type {typeof removeExtension} */
    removeExtension: null,
    /* Debugging */
    /** @type {typeof logAll} */
    logAll: null,
    /** @type {typeof logNone} */
    logNone: null,
    /* Debugging */
    /**
     * The logger htmx uses to log with
     *
     * @see https://htmx.org/api/#logger
     */
    logger: null,
    /**
     * A property holding the configuration htmx uses at runtime.
     *
     * Note that using a [meta tag](https://htmx.org/docs/#config) is the preferred mechanism for setting these properties.
     *
     * @see https://htmx.org/api/#config
     */
    config: {
      /**
       * Whether to use history.
       * @type boolean
       * @default true
       */
      historyEnabled: !0,
      /**
       * The number of pages to keep in **sessionStorage** for history support.
       * @type number
       * @default 10
       */
      historyCacheSize: 10,
      /**
       * @type boolean
       * @default false
       */
      refreshOnHistoryMiss: !1,
      /**
       * The default swap style to use if **[hx-swap](https://htmx.org/attributes/hx-swap)** is omitted.
       * @type HtmxSwapStyle
       * @default 'innerHTML'
       */
      defaultSwapStyle: "innerHTML",
      /**
       * The default delay between receiving a response from the server and doing the swap.
       * @type number
       * @default 0
       */
      defaultSwapDelay: 0,
      /**
       * The default delay between completing the content swap and settling attributes.
       * @type number
       * @default 20
       */
      defaultSettleDelay: 20,
      /**
       * If true, htmx will inject a small amount of CSS into the page to make indicators invisible unless the **htmx-indicator** class is present.
       * @type boolean
       * @default true
       */
      includeIndicatorStyles: !0,
      /**
       * The class to place on indicators when a request is in flight.
       * @type string
       * @default 'htmx-indicator'
       */
      indicatorClass: "htmx-indicator",
      /**
       * The class to place on triggering elements when a request is in flight.
       * @type string
       * @default 'htmx-request'
       */
      requestClass: "htmx-request",
      /**
       * The class to temporarily place on elements that htmx has added to the DOM.
       * @type string
       * @default 'htmx-added'
       */
      addedClass: "htmx-added",
      /**
       * The class to place on target elements when htmx is in the settling phase.
       * @type string
       * @default 'htmx-settling'
       */
      settlingClass: "htmx-settling",
      /**
       * The class to place on target elements when htmx is in the swapping phase.
       * @type string
       * @default 'htmx-swapping'
       */
      swappingClass: "htmx-swapping",
      /**
       * Allows the use of eval-like functionality in htmx, to enable **hx-vars**, trigger conditions & script tag evaluation. Can be set to **false** for CSP compatibility.
       * @type boolean
       * @default true
       */
      allowEval: !0,
      /**
       * If set to false, disables the interpretation of script tags.
       * @type boolean
       * @default true
       */
      allowScriptTags: !0,
      /**
       * If set, the nonce will be added to inline scripts.
       * @type string
       * @default ''
       */
      inlineScriptNonce: "",
      /**
       * If set, the nonce will be added to inline styles.
       * @type string
       * @default ''
       */
      inlineStyleNonce: "",
      /**
       * The attributes to settle during the settling phase.
       * @type string[]
       * @default ['class', 'style', 'width', 'height']
       */
      attributesToSettle: ["class", "style", "width", "height"],
      /**
       * Allow cross-site Access-Control requests using credentials such as cookies, authorization headers or TLS client certificates.
       * @type boolean
       * @default false
       */
      withCredentials: !1,
      /**
       * @type number
       * @default 0
       */
      timeout: 0,
      /**
       * The default implementation of **getWebSocketReconnectDelay** for reconnecting after unexpected connection loss by the event code **Abnormal Closure**, **Service Restart** or **Try Again Later**.
       * @type {'full-jitter' | ((retryCount:number) => number)}
       * @default "full-jitter"
       */
      wsReconnectDelay: "full-jitter",
      /**
       * The type of binary data being received over the WebSocket connection
       * @type BinaryType
       * @default 'blob'
       */
      wsBinaryType: "blob",
      /**
       * @type string
       * @default '[hx-disable], [data-hx-disable]'
       */
      disableSelector: "[hx-disable], [data-hx-disable]",
      /**
       * @type {'auto' | 'instant' | 'smooth'}
       * @default 'instant'
       */
      scrollBehavior: "instant",
      /**
       * If the focused element should be scrolled into view.
       * @type boolean
       * @default false
       */
      defaultFocusScroll: !1,
      /**
       * If set to true htmx will include a cache-busting parameter in GET requests to avoid caching partial responses by the browser
       * @type boolean
       * @default false
       */
      getCacheBusterParam: !1,
      /**
       * If set to true, htmx will use the View Transition API when swapping in new content.
       * @type boolean
       * @default false
       */
      globalViewTransitions: !1,
      /**
       * htmx will format requests with these methods by encoding their parameters in the URL, not the request body
       * @type {(HttpVerb)[]}
       * @default ['get', 'delete']
       */
      methodsThatUseUrlParams: ["get", "delete"],
      /**
       * If set to true, disables htmx-based requests to non-origin hosts.
       * @type boolean
       * @default false
       */
      selfRequestsOnly: !0,
      /**
       * If set to true htmx will not update the title of the document when a title tag is found in new content
       * @type boolean
       * @default false
       */
      ignoreTitle: !1,
      /**
       * Whether the target of a boosted element is scrolled into the viewport.
       * @type boolean
       * @default true
       */
      scrollIntoViewOnBoost: !0,
      /**
       * The cache to store evaluated trigger specifications into.
       * You may define a simple object to use a never-clearing cache, or implement your own system using a [proxy object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Proxy)
       * @type {Object|null}
       * @default null
       */
      triggerSpecsCache: null,
      /** @type boolean */
      disableInheritance: !1,
      /** @type HtmxResponseHandlingConfig[] */
      responseHandling: [
        { code: "204", swap: !1 },
        { code: "[23]..", swap: !0 },
        { code: "[45]..", swap: !1, error: !0 }
      ],
      /**
       * Whether to process OOB swaps on elements that are nested within the main response element.
       * @type boolean
       * @default true
       */
      allowNestedOobSwaps: !0,
      /**
       * Whether to treat history cache miss full page reload requests as a "HX-Request" by returning this response header
       * This should always be disabled when using HX-Request header to optionally return partial responses
       * @type boolean
       * @default true
       */
      historyRestoreAsHxRequest: !0,
      /**
       * Whether to report input validation errors to the end user and update focus to the first input that fails validation.
       * This should always be enabled as this matches default browser form submit behaviour
       * @type boolean
       * @default false
       */
      reportValidityOfForms: !1
    },
    /** @type {typeof parseInterval} */
    parseInterval: null,
    /**
     * proxy of window.location used for page reload functions
     * @type location
     */
    location,
    /** @type {typeof internalEval} */
    _: null,
    version: "2.0.8"
  };
  htmx.onLoad = onLoadHelper, htmx.process = processNode, htmx.on = addEventListenerImpl, htmx.off = removeEventListenerImpl, htmx.trigger = triggerEvent, htmx.ajax = ajaxHelper, htmx.find = find, htmx.findAll = findAll, htmx.closest = closest, htmx.remove = removeElement, htmx.addClass = addClassToElement, htmx.removeClass = removeClassFromElement, htmx.toggleClass = toggleClassOnElement, htmx.takeClass = takeClassForElement, htmx.swap = swap, htmx.defineExtension = defineExtension, htmx.removeExtension = removeExtension, htmx.logAll = logAll, htmx.logNone = logNone, htmx.parseInterval = parseInterval, htmx._ = internalEval;
  const internalAPI = {
    addTriggerHandler,
    bodyContains,
    canAccessLocalStorage,
    findThisElement,
    filterValues,
    swap,
    hasAttribute,
    getAttributeValue,
    getClosestAttributeValue,
    getClosestMatch,
    getExpressionVars,
    getHeaders,
    getInputValues,
    getInternalData,
    getSwapSpecification,
    getTriggerSpecs,
    getTarget,
    makeFragment,
    mergeObjects,
    makeSettleInfo,
    oobSwap,
    querySelectorExt,
    settleImmediately,
    shouldCancel,
    triggerEvent,
    triggerErrorEvent,
    withExtensions
  }, VERBS = ["get", "post", "put", "delete", "patch"], VERB_SELECTOR = VERBS.map(function(e) {
    return "[hx-" + e + "], [data-hx-" + e + "]";
  }).join(", ");
  function parseInterval(e) {
    if (e == null)
      return;
    let t = NaN;
    return e.slice(-2) == "ms" ? t = parseFloat(e.slice(0, -2)) : e.slice(-1) == "s" ? t = parseFloat(e.slice(0, -1)) * 1e3 : e.slice(-1) == "m" ? t = parseFloat(e.slice(0, -1)) * 1e3 * 60 : t = parseFloat(e), isNaN(t) ? void 0 : t;
  }
  function getRawAttribute(e, t) {
    return e instanceof Element && e.getAttribute(t);
  }
  function hasAttribute(e, t) {
    return !!e.hasAttribute && (e.hasAttribute(t) || e.hasAttribute("data-" + t));
  }
  function getAttributeValue(e, t) {
    return getRawAttribute(e, t) || getRawAttribute(e, "data-" + t);
  }
  function parentElt(e) {
    const t = e.parentElement;
    return !t && e.parentNode instanceof ShadowRoot ? e.parentNode : t;
  }
  function getDocument() {
    return document;
  }
  function getRootNode(e, t) {
    return e.getRootNode ? e.getRootNode({ composed: t }) : getDocument();
  }
  function getClosestMatch(e, t) {
    for (; e && !t(e); )
      e = parentElt(e);
    return e || null;
  }
  function getAttributeValueWithDisinheritance(e, t, n) {
    const i = getAttributeValue(t, n), r = getAttributeValue(t, "hx-disinherit");
    var a = getAttributeValue(t, "hx-inherit");
    if (e !== t) {
      if (htmx.config.disableInheritance)
        return a && (a === "*" || a.split(" ").indexOf(n) >= 0) ? i : null;
      if (r && (r === "*" || r.split(" ").indexOf(n) >= 0))
        return "unset";
    }
    return i;
  }
  function getClosestAttributeValue(e, t) {
    let n = null;
    if (getClosestMatch(e, function(i) {
      return !!(n = getAttributeValueWithDisinheritance(e, asElement(i), t));
    }), n !== "unset")
      return n;
  }
  function matches(e, t) {
    return e instanceof Element && e.matches(t);
  }
  function getStartTag(e) {
    const n = /<([a-z][^\/\0>\x20\t\r\n\f]*)/i.exec(e);
    return n ? n[1].toLowerCase() : "";
  }
  function parseHTML(e) {
    return "parseHTMLUnsafe" in Document ? Document.parseHTMLUnsafe(e) : new DOMParser().parseFromString(e, "text/html");
  }
  function takeChildrenFor(e, t) {
    for (; t.childNodes.length > 0; )
      e.append(t.childNodes[0]);
  }
  function duplicateScript(e) {
    const t = getDocument().createElement("script");
    return forEach(e.attributes, function(n) {
      t.setAttribute(n.name, n.value);
    }), t.textContent = e.textContent, t.async = !1, htmx.config.inlineScriptNonce && (t.nonce = htmx.config.inlineScriptNonce), t;
  }
  function isJavaScriptScriptNode(e) {
    return e.matches("script") && (e.type === "text/javascript" || e.type === "module" || e.type === "");
  }
  function normalizeScriptTags(e) {
    Array.from(e.querySelectorAll("script")).forEach(
      /** @param {HTMLScriptElement} script */
      (t) => {
        if (isJavaScriptScriptNode(t)) {
          const n = duplicateScript(t), i = t.parentNode;
          try {
            i.insertBefore(n, t);
          } catch (r) {
            logError(r);
          } finally {
            t.remove();
          }
        }
      }
    );
  }
  function makeFragment(e) {
    const t = e.replace(/<head(\s[^>]*)?>[\s\S]*?<\/head>/i, ""), n = getStartTag(t);
    let i;
    if (n === "html") {
      i = /** @type DocumentFragmentWithTitle */
      new DocumentFragment();
      const a = parseHTML(e);
      takeChildrenFor(i, a.body), i.title = a.title;
    } else if (n === "body") {
      i = /** @type DocumentFragmentWithTitle */
      new DocumentFragment();
      const a = parseHTML(t);
      takeChildrenFor(i, a.body), i.title = a.title;
    } else {
      const a = parseHTML('<body><template class="internal-htmx-wrapper">' + t + "</template></body>");
      i = /** @type DocumentFragmentWithTitle */
      a.querySelector("template").content, i.title = a.title;
      var r = i.querySelector("title");
      r && r.parentNode === i && (r.remove(), i.title = r.innerText);
    }
    return i && (htmx.config.allowScriptTags ? normalizeScriptTags(i) : i.querySelectorAll("script").forEach((a) => a.remove())), i;
  }
  function maybeCall(e) {
    e && e();
  }
  function isType(e, t) {
    return Object.prototype.toString.call(e) === "[object " + t + "]";
  }
  function isFunction(e) {
    return typeof e == "function";
  }
  function isRawObject(e) {
    return isType(e, "Object");
  }
  function getInternalData(e) {
    const t = "htmx-internal-data";
    let n = e[t];
    return n || (n = e[t] = {}), n;
  }
  function toArray(e) {
    const t = [];
    if (e)
      for (let n = 0; n < e.length; n++)
        t.push(e[n]);
    return t;
  }
  function forEach(e, t) {
    if (e)
      for (let n = 0; n < e.length; n++)
        t(e[n]);
  }
  function isScrolledIntoView(e) {
    const t = e.getBoundingClientRect(), n = t.top, i = t.bottom;
    return n < window.innerHeight && i >= 0;
  }
  function bodyContains(e) {
    return e.getRootNode({ composed: !0 }) === document;
  }
  function splitOnWhitespace(e) {
    return e.trim().split(/\s+/);
  }
  function mergeObjects(e, t) {
    for (const n in t)
      t.hasOwnProperty(n) && (e[n] = t[n]);
    return e;
  }
  function parseJSON(e) {
    try {
      return JSON.parse(e);
    } catch (t) {
      return logError(t), null;
    }
  }
  function canAccessLocalStorage() {
    const e = "htmx:sessionStorageTest";
    try {
      return sessionStorage.setItem(e, e), sessionStorage.removeItem(e), !0;
    } catch {
      return !1;
    }
  }
  function normalizePath(e) {
    const t = new URL(e, "http://x");
    return t && (e = t.pathname + t.search), e != "/" && (e = e.replace(/\/+$/, "")), e;
  }
  function internalEval(str) {
    return maybeEval(getDocument().body, function() {
      return eval(str);
    });
  }
  function onLoadHelper(e) {
    return htmx.on(
      "htmx:load",
      /** @param {CustomEvent} evt */
      function(n) {
        e(n.detail.elt);
      }
    );
  }
  function logAll() {
    htmx.logger = function(e, t, n) {
      console && console.log(t, e, n);
    };
  }
  function logNone() {
    htmx.logger = null;
  }
  function find(e, t) {
    return typeof e != "string" ? e.querySelector(t) : find(getDocument(), e);
  }
  function findAll(e, t) {
    return typeof e != "string" ? e.querySelectorAll(t) : findAll(getDocument(), e);
  }
  function getWindow() {
    return window;
  }
  function removeElement(e, t) {
    e = resolveTarget(e), t ? getWindow().setTimeout(function() {
      removeElement(e), e = null;
    }, t) : parentElt(e).removeChild(e);
  }
  function asElement(e) {
    return e instanceof Element ? e : null;
  }
  function asHtmlElement(e) {
    return e instanceof HTMLElement ? e : null;
  }
  function asString(e) {
    return typeof e == "string" ? e : null;
  }
  function asParentNode(e) {
    return e instanceof Element || e instanceof Document || e instanceof DocumentFragment ? e : null;
  }
  function addClassToElement(e, t, n) {
    e = asElement(resolveTarget(e)), e && (n ? getWindow().setTimeout(function() {
      addClassToElement(e, t), e = null;
    }, n) : e.classList && e.classList.add(t));
  }
  function removeClassFromElement(e, t, n) {
    let i = asElement(resolveTarget(e));
    i && (n ? getWindow().setTimeout(function() {
      removeClassFromElement(i, t), i = null;
    }, n) : i.classList && (i.classList.remove(t), i.classList.length === 0 && i.removeAttribute("class")));
  }
  function toggleClassOnElement(e, t) {
    e = resolveTarget(e), e.classList.toggle(t);
  }
  function takeClassForElement(e, t) {
    e = resolveTarget(e), forEach(e.parentElement.children, function(n) {
      removeClassFromElement(n, t);
    }), addClassToElement(asElement(e), t);
  }
  function closest(e, t) {
    return e = asElement(resolveTarget(e)), e ? e.closest(t) : null;
  }
  function startsWith(e, t) {
    return e.substring(0, t.length) === t;
  }
  function endsWith(e, t) {
    return e.substring(e.length - t.length) === t;
  }
  function normalizeSelector(e) {
    const t = e.trim();
    return startsWith(t, "<") && endsWith(t, "/>") ? t.substring(1, t.length - 2) : t;
  }
  function querySelectorAllExt(e, t, n) {
    if (t.indexOf("global ") === 0)
      return querySelectorAllExt(e, t.slice(7), !0);
    e = resolveTarget(e);
    const i = [];
    {
      let s = 0, o = 0;
      for (let l = 0; l < t.length; l++) {
        const c = t[l];
        if (c === "," && s === 0) {
          i.push(t.substring(o, l)), o = l + 1;
          continue;
        }
        c === "<" ? s++ : c === "/" && l < t.length - 1 && t[l + 1] === ">" && s--;
      }
      o < t.length && i.push(t.substring(o));
    }
    const r = [], a = [];
    for (; i.length > 0; ) {
      const s = normalizeSelector(i.shift());
      let o;
      s.indexOf("closest ") === 0 ? o = closest(asElement(e), normalizeSelector(s.slice(8))) : s.indexOf("find ") === 0 ? o = find(asParentNode(e), normalizeSelector(s.slice(5))) : s === "next" || s === "nextElementSibling" ? o = asElement(e).nextElementSibling : s.indexOf("next ") === 0 ? o = scanForwardQuery(e, normalizeSelector(s.slice(5)), !!n) : s === "previous" || s === "previousElementSibling" ? o = asElement(e).previousElementSibling : s.indexOf("previous ") === 0 ? o = scanBackwardsQuery(e, normalizeSelector(s.slice(9)), !!n) : s === "document" ? o = document : s === "window" ? o = window : s === "body" ? o = document.body : s === "root" ? o = getRootNode(e, !!n) : s === "host" ? o = /** @type ShadowRoot */
      e.getRootNode().host : a.push(s), o && r.push(o);
    }
    if (a.length > 0) {
      const s = a.join(","), o = asParentNode(getRootNode(e, !!n));
      r.push(...toArray(o.querySelectorAll(s)));
    }
    return r;
  }
  var scanForwardQuery = function(e, t, n) {
    const i = asParentNode(getRootNode(e, n)).querySelectorAll(t);
    for (let r = 0; r < i.length; r++) {
      const a = i[r];
      if (a.compareDocumentPosition(e) === Node.DOCUMENT_POSITION_PRECEDING)
        return a;
    }
  }, scanBackwardsQuery = function(e, t, n) {
    const i = asParentNode(getRootNode(e, n)).querySelectorAll(t);
    for (let r = i.length - 1; r >= 0; r--) {
      const a = i[r];
      if (a.compareDocumentPosition(e) === Node.DOCUMENT_POSITION_FOLLOWING)
        return a;
    }
  };
  function querySelectorExt(e, t) {
    return typeof e != "string" ? querySelectorAllExt(e, t)[0] : querySelectorAllExt(getDocument().body, e)[0];
  }
  function resolveTarget(e, t) {
    return typeof e == "string" ? find(asParentNode(t) || document, e) : e;
  }
  function processEventArgs(e, t, n, i) {
    return isFunction(t) ? {
      target: getDocument().body,
      event: asString(e),
      listener: t,
      options: n
    } : {
      target: resolveTarget(e),
      event: asString(t),
      listener: n,
      options: i
    };
  }
  function addEventListenerImpl(e, t, n, i) {
    return ready(function() {
      const a = processEventArgs(e, t, n, i);
      a.target.addEventListener(a.event, a.listener, a.options);
    }), isFunction(t) ? t : n;
  }
  function removeEventListenerImpl(e, t, n) {
    return ready(function() {
      const i = processEventArgs(e, t, n);
      i.target.removeEventListener(i.event, i.listener);
    }), isFunction(t) ? t : n;
  }
  const DUMMY_ELT = getDocument().createElement("output");
  function findAttributeTargets(e, t) {
    const n = getClosestAttributeValue(e, t);
    if (n) {
      if (n === "this")
        return [findThisElement(e, t)];
      {
        const i = querySelectorAllExt(e, n);
        if (/(^|,)(\s*)inherit(\s*)($|,)/.test(n)) {
          const a = asElement(getClosestMatch(e, function(s) {
            return s !== e && hasAttribute(asElement(s), t);
          }));
          a && i.push(...findAttributeTargets(a, t));
        }
        return i.length === 0 ? (logError('The selector "' + n + '" on ' + t + " returned no matches!"), [DUMMY_ELT]) : i;
      }
    }
  }
  function findThisElement(e, t) {
    return asElement(getClosestMatch(e, function(n) {
      return getAttributeValue(asElement(n), t) != null;
    }));
  }
  function getTarget(e) {
    const t = getClosestAttributeValue(e, "hx-target");
    return t ? t === "this" ? findThisElement(e, "hx-target") : querySelectorExt(e, t) : getInternalData(e).boosted ? getDocument().body : e;
  }
  function shouldSettleAttribute(e) {
    return htmx.config.attributesToSettle.includes(e);
  }
  function cloneAttributes(e, t) {
    forEach(Array.from(e.attributes), function(n) {
      !t.hasAttribute(n.name) && shouldSettleAttribute(n.name) && e.removeAttribute(n.name);
    }), forEach(t.attributes, function(n) {
      shouldSettleAttribute(n.name) && e.setAttribute(n.name, n.value);
    });
  }
  function isInlineSwap(e, t) {
    const n = getExtensions(t);
    for (let i = 0; i < n.length; i++) {
      const r = n[i];
      try {
        if (r.isInlineSwap(e))
          return !0;
      } catch (a) {
        logError(a);
      }
    }
    return e === "outerHTML";
  }
  function oobSwap(e, t, n, i) {
    i = i || getDocument();
    let r = "#" + CSS.escape(getRawAttribute(t, "id")), a = "outerHTML";
    e === "true" || (e.indexOf(":") > 0 ? (a = e.substring(0, e.indexOf(":")), r = e.substring(e.indexOf(":") + 1)) : a = e), t.removeAttribute("hx-swap-oob"), t.removeAttribute("data-hx-swap-oob");
    const s = querySelectorAllExt(i, r, !1);
    return s.length ? (forEach(
      s,
      function(o) {
        let l;
        const c = t.cloneNode(!0);
        l = getDocument().createDocumentFragment(), l.appendChild(c), isInlineSwap(a, o) || (l = asParentNode(c));
        const u = { shouldSwap: !0, target: o, fragment: l };
        triggerEvent(o, "htmx:oobBeforeSwap", u) && (o = u.target, u.shouldSwap && (handlePreservedElements(l), swapWithStyle(a, o, o, l, n), restorePreservedElements()), forEach(n.elts, function(d) {
          triggerEvent(d, "htmx:oobAfterSwap", u);
        }));
      }
    ), t.parentNode.removeChild(t)) : (t.parentNode.removeChild(t), triggerErrorEvent(getDocument().body, "htmx:oobErrorNoTarget", { content: t })), e;
  }
  function restorePreservedElements() {
    const e = find("#--htmx-preserve-pantry--");
    if (e) {
      for (const t of [...e.children]) {
        const n = find("#" + t.id);
        n.parentNode.moveBefore(t, n), n.remove();
      }
      e.remove();
    }
  }
  function handlePreservedElements(e) {
    forEach(findAll(e, "[hx-preserve], [data-hx-preserve]"), function(t) {
      const n = getAttributeValue(t, "id"), i = getDocument().getElementById(n);
      if (i != null)
        if (t.moveBefore) {
          let r = find("#--htmx-preserve-pantry--");
          r == null && (getDocument().body.insertAdjacentHTML("afterend", "<div id='--htmx-preserve-pantry--'></div>"), r = find("#--htmx-preserve-pantry--")), r.moveBefore(i, null);
        } else
          t.parentNode.replaceChild(i, t);
    });
  }
  function handleAttributes(e, t, n) {
    forEach(t.querySelectorAll("[id]"), function(i) {
      const r = getRawAttribute(i, "id");
      if (r && r.length > 0) {
        const a = r.replace("'", "\\'"), s = i.tagName.replace(":", "\\:"), o = asParentNode(e), l = o && o.querySelector(s + "[id='" + a + "']");
        if (l && l !== o) {
          const c = i.cloneNode();
          cloneAttributes(i, l), n.tasks.push(function() {
            cloneAttributes(i, c);
          });
        }
      }
    });
  }
  function makeAjaxLoadTask(e) {
    return function() {
      removeClassFromElement(e, htmx.config.addedClass), processNode(asElement(e)), processFocus(asParentNode(e)), triggerEvent(e, "htmx:load");
    };
  }
  function processFocus(e) {
    const t = "[autofocus]", n = asHtmlElement(matches(e, t) ? e : e.querySelector(t));
    n?.focus();
  }
  function insertNodesBefore(e, t, n, i) {
    for (handleAttributes(e, n, i); n.childNodes.length > 0; ) {
      const r = n.firstChild;
      addClassToElement(asElement(r), htmx.config.addedClass), e.insertBefore(r, t), r.nodeType !== Node.TEXT_NODE && r.nodeType !== Node.COMMENT_NODE && i.tasks.push(makeAjaxLoadTask(r));
    }
  }
  function stringHash(e, t) {
    let n = 0;
    for (; n < e.length; )
      t = (t << 5) - t + e.charCodeAt(n++) | 0;
    return t;
  }
  function attributeHash(e) {
    let t = 0;
    for (let n = 0; n < e.attributes.length; n++) {
      const i = e.attributes[n];
      i.value && (t = stringHash(i.name, t), t = stringHash(i.value, t));
    }
    return t;
  }
  function deInitOnHandlers(e) {
    const t = getInternalData(e);
    if (t.onHandlers) {
      for (let n = 0; n < t.onHandlers.length; n++) {
        const i = t.onHandlers[n];
        removeEventListenerImpl(e, i.event, i.listener);
      }
      delete t.onHandlers;
    }
  }
  function deInitNode(e) {
    const t = getInternalData(e);
    t.timeout && clearTimeout(t.timeout), t.listenerInfos && forEach(t.listenerInfos, function(n) {
      n.on && removeEventListenerImpl(n.on, n.trigger, n.listener);
    }), deInitOnHandlers(e), forEach(Object.keys(t), function(n) {
      n !== "firstInitCompleted" && delete t[n];
    });
  }
  function cleanUpElement(e) {
    triggerEvent(e, "htmx:beforeCleanupElement"), deInitNode(e), forEach(e.children, function(t) {
      cleanUpElement(t);
    });
  }
  function swapOuterHTML(e, t, n) {
    if (e.tagName === "BODY")
      return swapInnerHTML(e, t, n);
    let i;
    const r = e.previousSibling, a = parentElt(e);
    if (a) {
      for (insertNodesBefore(a, e, t, n), r == null ? i = a.firstChild : i = r.nextSibling, n.elts = n.elts.filter(function(s) {
        return s !== e;
      }); i && i !== e; )
        i instanceof Element && n.elts.push(i), i = i.nextSibling;
      cleanUpElement(e), e.remove();
    }
  }
  function swapAfterBegin(e, t, n) {
    return insertNodesBefore(e, e.firstChild, t, n);
  }
  function swapBeforeBegin(e, t, n) {
    return insertNodesBefore(parentElt(e), e, t, n);
  }
  function swapBeforeEnd(e, t, n) {
    return insertNodesBefore(e, null, t, n);
  }
  function swapAfterEnd(e, t, n) {
    return insertNodesBefore(parentElt(e), e.nextSibling, t, n);
  }
  function swapDelete(e) {
    cleanUpElement(e);
    const t = parentElt(e);
    if (t)
      return t.removeChild(e);
  }
  function swapInnerHTML(e, t, n) {
    const i = e.firstChild;
    if (insertNodesBefore(e, i, t, n), i) {
      for (; i.nextSibling; )
        cleanUpElement(i.nextSibling), e.removeChild(i.nextSibling);
      cleanUpElement(i), e.removeChild(i);
    }
  }
  function swapWithStyle(e, t, n, i, r) {
    switch (e) {
      case "none":
        return;
      case "outerHTML":
        swapOuterHTML(n, i, r);
        return;
      case "afterbegin":
        swapAfterBegin(n, i, r);
        return;
      case "beforebegin":
        swapBeforeBegin(n, i, r);
        return;
      case "beforeend":
        swapBeforeEnd(n, i, r);
        return;
      case "afterend":
        swapAfterEnd(n, i, r);
        return;
      case "delete":
        swapDelete(n);
        return;
      default:
        var a = getExtensions(t);
        for (let s = 0; s < a.length; s++) {
          const o = a[s];
          try {
            const l = o.handleSwap(e, n, i, r);
            if (l) {
              if (Array.isArray(l))
                for (let c = 0; c < l.length; c++) {
                  const u = l[c];
                  u.nodeType !== Node.TEXT_NODE && u.nodeType !== Node.COMMENT_NODE && r.tasks.push(makeAjaxLoadTask(u));
                }
              return;
            }
          } catch (l) {
            logError(l);
          }
        }
        e === "innerHTML" ? swapInnerHTML(n, i, r) : swapWithStyle(htmx.config.defaultSwapStyle, t, n, i, r);
    }
  }
  function findAndSwapOobElements(e, t, n) {
    var i = findAll(e, "[hx-swap-oob], [data-hx-swap-oob]");
    return forEach(i, function(r) {
      if (htmx.config.allowNestedOobSwaps || r.parentElement === null) {
        const a = getAttributeValue(r, "hx-swap-oob");
        a != null && oobSwap(a, r, t, n);
      } else
        r.removeAttribute("hx-swap-oob"), r.removeAttribute("data-hx-swap-oob");
    }), i.length > 0;
  }
  function swap(e, t, n, i) {
    i || (i = {});
    let r = null, a = null, s = function() {
      maybeCall(i.beforeSwapCallback), e = resolveTarget(e);
      const c = i.contextElement ? getRootNode(i.contextElement, !1) : getDocument(), u = document.activeElement;
      let d = {};
      d = {
        elt: u,
        // @ts-ignore
        start: u ? u.selectionStart : null,
        // @ts-ignore
        end: u ? u.selectionEnd : null
      };
      const h = makeSettleInfo(e);
      if (n.swapStyle === "textContent")
        e.textContent = t;
      else {
        let v = makeFragment(t);
        if (h.title = i.title || v.title, i.historyRequest && (v = v.querySelector("[hx-history-elt],[data-hx-history-elt]") || v), i.selectOOB) {
          const x = i.selectOOB.split(",");
          for (let m = 0; m < x.length; m++) {
            const E = x[m].split(":", 2);
            let g = E[0].trim();
            g.indexOf("#") === 0 && (g = g.substring(1));
            const y = E[1] || "true", f = v.querySelector("#" + g);
            f && oobSwap(y, f, h, c);
          }
        }
        if (findAndSwapOobElements(v, h, c), forEach(
          findAll(v, "template"),
          /** @param {HTMLTemplateElement} template */
          function(x) {
            x.content && findAndSwapOobElements(x.content, h, c) && x.remove();
          }
        ), i.select) {
          const x = getDocument().createDocumentFragment();
          forEach(v.querySelectorAll(i.select), function(m) {
            x.appendChild(m);
          }), v = x;
        }
        handlePreservedElements(v), swapWithStyle(n.swapStyle, i.contextElement, e, v, h), restorePreservedElements();
      }
      if (d.elt && !bodyContains(d.elt) && getRawAttribute(d.elt, "id")) {
        const v = document.getElementById(getRawAttribute(d.elt, "id")), x = { preventScroll: n.focusScroll !== void 0 ? !n.focusScroll : !htmx.config.defaultFocusScroll };
        if (v) {
          if (d.start && v.setSelectionRange)
            try {
              v.setSelectionRange(d.start, d.end);
            } catch {
            }
          v.focus(x);
        }
      }
      e.classList.remove(htmx.config.swappingClass), forEach(h.elts, function(v) {
        v.classList && v.classList.add(htmx.config.settlingClass), triggerEvent(v, "htmx:afterSwap", i.eventInfo);
      }), maybeCall(i.afterSwapCallback), n.ignoreTitle || handleTitle(h.title);
      const b = function() {
        if (forEach(h.tasks, function(v) {
          v.call();
        }), forEach(h.elts, function(v) {
          v.classList && v.classList.remove(htmx.config.settlingClass), triggerEvent(v, "htmx:afterSettle", i.eventInfo);
        }), i.anchor) {
          const v = asElement(resolveTarget("#" + i.anchor));
          v && v.scrollIntoView({ block: "start", behavior: "auto" });
        }
        updateScrollState(h.elts, n), maybeCall(i.afterSettleCallback), maybeCall(r);
      };
      n.settleDelay > 0 ? getWindow().setTimeout(b, n.settleDelay) : b();
    }, o = htmx.config.globalViewTransitions;
    n.hasOwnProperty("transition") && (o = n.transition);
    const l = i.contextElement || getDocument();
    if (o && triggerEvent(l, "htmx:beforeTransition", i.eventInfo) && typeof Promise < "u" && // @ts-ignore experimental feature atm
    document.startViewTransition) {
      const c = new Promise(function(d, h) {
        r = d, a = h;
      }), u = s;
      s = function() {
        document.startViewTransition(function() {
          return u(), c;
        });
      };
    }
    try {
      n?.swapDelay && n.swapDelay > 0 ? getWindow().setTimeout(s, n.swapDelay) : s();
    } catch (c) {
      throw triggerErrorEvent(l, "htmx:swapError", i.eventInfo), maybeCall(a), c;
    }
  }
  function handleTriggerHeader(e, t, n) {
    const i = e.getResponseHeader(t);
    if (i.indexOf("{") === 0) {
      const r = parseJSON(i);
      for (const a in r)
        if (r.hasOwnProperty(a)) {
          let s = r[a];
          isRawObject(s) ? n = s.target !== void 0 ? s.target : n : s = { value: s }, triggerEvent(n, a, s);
        }
    } else {
      const r = i.split(",");
      for (let a = 0; a < r.length; a++)
        triggerEvent(n, r[a].trim(), []);
    }
  }
  const WHITESPACE_OR_COMMA = /[\s,]/, SYMBOL_START = /[_$a-zA-Z]/, SYMBOL_CONT = /[_$a-zA-Z0-9]/, STRINGISH_START = ['"', "'", "/"], NOT_WHITESPACE = /[^\s]/, COMBINED_SELECTOR_START = /[{(]/, COMBINED_SELECTOR_END = /[})]/;
  function tokenizeString(e) {
    const t = [];
    let n = 0;
    for (; n < e.length; ) {
      if (SYMBOL_START.exec(e.charAt(n))) {
        for (var i = n; SYMBOL_CONT.exec(e.charAt(n + 1)); )
          n++;
        t.push(e.substring(i, n + 1));
      } else if (STRINGISH_START.indexOf(e.charAt(n)) !== -1) {
        const r = e.charAt(n);
        var i = n;
        for (n++; n < e.length && e.charAt(n) !== r; )
          e.charAt(n) === "\\" && n++, n++;
        t.push(e.substring(i, n + 1));
      } else {
        const r = e.charAt(n);
        t.push(r);
      }
      n++;
    }
    return t;
  }
  function isPossibleRelativeReference(e, t, n) {
    return SYMBOL_START.exec(e.charAt(0)) && e !== "true" && e !== "false" && e !== "this" && e !== n && t !== ".";
  }
  function maybeGenerateConditional(e, t, n) {
    if (t[0] === "[") {
      t.shift();
      let i = 1, r = " return (function(" + n + "){ return (", a = null;
      for (; t.length > 0; ) {
        const s = t[0];
        if (s === "]") {
          if (i--, i === 0) {
            a === null && (r = r + "true"), t.shift(), r += ")})";
            try {
              const o = maybeEval(
                e,
                function() {
                  return Function(r)();
                },
                function() {
                  return !0;
                }
              );
              return o.source = r, o;
            } catch (o) {
              return triggerErrorEvent(getDocument().body, "htmx:syntax:error", { error: o, source: r }), null;
            }
          }
        } else s === "[" && i++;
        isPossibleRelativeReference(s, a, n) ? r += "((" + n + "." + s + ") ? (" + n + "." + s + ") : (window." + s + "))" : r = r + s, a = t.shift();
      }
    }
  }
  function consumeUntil(e, t) {
    let n = "";
    for (; e.length > 0 && !t.test(e[0]); )
      n += e.shift();
    return n;
  }
  function consumeCSSSelector(e) {
    let t;
    return e.length > 0 && COMBINED_SELECTOR_START.test(e[0]) ? (e.shift(), t = consumeUntil(e, COMBINED_SELECTOR_END).trim(), e.shift()) : t = consumeUntil(e, WHITESPACE_OR_COMMA), t;
  }
  const INPUT_SELECTOR = "input, textarea, select";
  function parseAndCacheTrigger(e, t, n) {
    const i = [], r = tokenizeString(t);
    do {
      consumeUntil(r, NOT_WHITESPACE);
      const o = r.length, l = consumeUntil(r, /[,\[\s]/);
      if (l !== "")
        if (l === "every") {
          const c = { trigger: "every" };
          consumeUntil(r, NOT_WHITESPACE), c.pollInterval = parseInterval(consumeUntil(r, /[,\[\s]/)), consumeUntil(r, NOT_WHITESPACE);
          var a = maybeGenerateConditional(e, r, "event");
          a && (c.eventFilter = a), i.push(c);
        } else {
          const c = { trigger: l };
          var a = maybeGenerateConditional(e, r, "event");
          for (a && (c.eventFilter = a), consumeUntil(r, NOT_WHITESPACE); r.length > 0 && r[0] !== ","; ) {
            const d = r.shift();
            if (d === "changed")
              c.changed = !0;
            else if (d === "once")
              c.once = !0;
            else if (d === "consume")
              c.consume = !0;
            else if (d === "delay" && r[0] === ":")
              r.shift(), c.delay = parseInterval(consumeUntil(r, WHITESPACE_OR_COMMA));
            else if (d === "from" && r[0] === ":") {
              if (r.shift(), COMBINED_SELECTOR_START.test(r[0]))
                var s = consumeCSSSelector(r);
              else {
                var s = consumeUntil(r, WHITESPACE_OR_COMMA);
                if (s === "closest" || s === "find" || s === "next" || s === "previous") {
                  r.shift();
                  const b = consumeCSSSelector(r);
                  b.length > 0 && (s += " " + b);
                }
              }
              c.from = s;
            } else d === "target" && r[0] === ":" ? (r.shift(), c.target = consumeCSSSelector(r)) : d === "throttle" && r[0] === ":" ? (r.shift(), c.throttle = parseInterval(consumeUntil(r, WHITESPACE_OR_COMMA))) : d === "queue" && r[0] === ":" ? (r.shift(), c.queue = consumeUntil(r, WHITESPACE_OR_COMMA)) : d === "root" && r[0] === ":" ? (r.shift(), c[d] = consumeCSSSelector(r)) : d === "threshold" && r[0] === ":" ? (r.shift(), c[d] = consumeUntil(r, WHITESPACE_OR_COMMA)) : triggerErrorEvent(e, "htmx:syntax:error", { token: r.shift() });
            consumeUntil(r, NOT_WHITESPACE);
          }
          i.push(c);
        }
      r.length === o && triggerErrorEvent(e, "htmx:syntax:error", { token: r.shift() }), consumeUntil(r, NOT_WHITESPACE);
    } while (r[0] === "," && r.shift());
    return n && (n[t] = i), i;
  }
  function getTriggerSpecs(e) {
    const t = getAttributeValue(e, "hx-trigger");
    let n = [];
    if (t) {
      const i = htmx.config.triggerSpecsCache;
      n = i && i[t] || parseAndCacheTrigger(e, t, i);
    }
    return n.length > 0 ? n : matches(e, "form") ? [{ trigger: "submit" }] : matches(e, 'input[type="button"], input[type="submit"]') ? [{ trigger: "click" }] : matches(e, INPUT_SELECTOR) ? [{ trigger: "change" }] : [{ trigger: "click" }];
  }
  function cancelPolling(e) {
    getInternalData(e).cancelled = !0;
  }
  function processPolling(e, t, n) {
    const i = getInternalData(e);
    i.timeout = getWindow().setTimeout(function() {
      bodyContains(e) && i.cancelled !== !0 && (maybeFilterEvent(n, e, makeEvent("hx:poll:trigger", {
        triggerSpec: n,
        target: e
      })) || t(e), processPolling(e, t, n));
    }, n.pollInterval);
  }
  function isLocalLink(e) {
    return location.hostname === e.hostname && getRawAttribute(e, "href") && getRawAttribute(e, "href").indexOf("#") !== 0;
  }
  function eltIsDisabled(e) {
    return closest(e, htmx.config.disableSelector);
  }
  function boostElement(e, t, n) {
    if (e instanceof HTMLAnchorElement && isLocalLink(e) && (e.target === "" || e.target === "_self") || e.tagName === "FORM" && String(getRawAttribute(e, "method")).toLowerCase() !== "dialog") {
      t.boosted = !0;
      let i, r;
      if (e.tagName === "A")
        i = /** @type HttpVerb */
        "get", r = getRawAttribute(e, "href");
      else {
        const a = getRawAttribute(e, "method");
        i = /** @type HttpVerb */
        a ? a.toLowerCase() : "get", r = getRawAttribute(e, "action"), (r == null || r === "") && (r = location.href), i === "get" && r.includes("?") && (r = r.replace(/\?[^#]+/, ""));
      }
      n.forEach(function(a) {
        addEventListener(e, function(s, o) {
          const l = asElement(s);
          if (eltIsDisabled(l)) {
            cleanUpElement(l);
            return;
          }
          issueAjaxRequest(i, r, l, o);
        }, t, a, !0);
      });
    }
  }
  function shouldCancel(e, t) {
    if (e.type === "submit" && t.tagName === "FORM")
      return !0;
    if (e.type === "click") {
      const n = (
        /** @type {HTMLButtonElement|HTMLInputElement|null} */
        t.closest('input[type="submit"], button')
      );
      if (n && n.form && n.type === "submit")
        return !0;
      const i = t.closest("a"), r = /^#.+/;
      if (i && i.href && !r.test(i.getAttribute("href")))
        return !0;
    }
    return !1;
  }
  function ignoreBoostedAnchorCtrlClick(e, t) {
    return getInternalData(e).boosted && e instanceof HTMLAnchorElement && t.type === "click" && // @ts-ignore this will resolve to undefined for events that don't define those properties, which is fine
    (t.ctrlKey || t.metaKey);
  }
  function maybeFilterEvent(e, t, n) {
    const i = e.eventFilter;
    if (i)
      try {
        return i.call(t, n) !== !0;
      } catch (r) {
        const a = i.source;
        return triggerErrorEvent(getDocument().body, "htmx:eventFilter:error", { error: r, source: a }), !0;
      }
    return !1;
  }
  function addEventListener(e, t, n, i, r) {
    const a = getInternalData(e);
    let s;
    i.from ? s = querySelectorAllExt(e, i.from) : s = [e], i.changed && ("lastValue" in a || (a.lastValue = /* @__PURE__ */ new WeakMap()), s.forEach(function(o) {
      a.lastValue.has(i) || a.lastValue.set(i, /* @__PURE__ */ new WeakMap()), a.lastValue.get(i).set(o, o.value);
    })), forEach(s, function(o) {
      const l = function(c) {
        if (!bodyContains(e)) {
          o.removeEventListener(i.trigger, l);
          return;
        }
        if (ignoreBoostedAnchorCtrlClick(e, c) || ((r || shouldCancel(c, o)) && c.preventDefault(), maybeFilterEvent(i, e, c)))
          return;
        const u = getInternalData(c);
        if (u.triggerSpec = i, u.handledFor == null && (u.handledFor = []), u.handledFor.indexOf(e) < 0) {
          if (u.handledFor.push(e), i.consume && c.stopPropagation(), i.target && c.target && !matches(asElement(c.target), i.target))
            return;
          if (i.once) {
            if (a.triggeredOnce)
              return;
            a.triggeredOnce = !0;
          }
          if (i.changed) {
            const d = c.target, h = d.value, b = a.lastValue.get(i);
            if (b.has(d) && b.get(d) === h)
              return;
            b.set(d, h);
          }
          if (a.delayed && clearTimeout(a.delayed), a.throttle)
            return;
          i.throttle > 0 ? a.throttle || (triggerEvent(e, "htmx:trigger"), t(e, c), a.throttle = getWindow().setTimeout(function() {
            a.throttle = null;
          }, i.throttle)) : i.delay > 0 ? a.delayed = getWindow().setTimeout(function() {
            triggerEvent(e, "htmx:trigger"), t(e, c);
          }, i.delay) : (triggerEvent(e, "htmx:trigger"), t(e, c));
        }
      };
      n.listenerInfos == null && (n.listenerInfos = []), n.listenerInfos.push({
        trigger: i.trigger,
        listener: l,
        on: o
      }), o.addEventListener(i.trigger, l);
    });
  }
  let windowIsScrolling = !1, scrollHandler = null;
  function initScrollHandler() {
    scrollHandler || (scrollHandler = function() {
      windowIsScrolling = !0;
    }, window.addEventListener("scroll", scrollHandler), window.addEventListener("resize", scrollHandler), setInterval(function() {
      windowIsScrolling && (windowIsScrolling = !1, forEach(getDocument().querySelectorAll("[hx-trigger*='revealed'],[data-hx-trigger*='revealed']"), function(e) {
        maybeReveal(e);
      }));
    }, 200));
  }
  function maybeReveal(e) {
    !hasAttribute(e, "data-hx-revealed") && isScrolledIntoView(e) && (e.setAttribute("data-hx-revealed", "true"), getInternalData(e).initHash ? triggerEvent(e, "revealed") : e.addEventListener("htmx:afterProcessNode", function() {
      triggerEvent(e, "revealed");
    }, { once: !0 }));
  }
  function loadImmediately(e, t, n, i) {
    const r = function() {
      n.loaded || (n.loaded = !0, triggerEvent(e, "htmx:trigger"), t(e));
    };
    i > 0 ? getWindow().setTimeout(r, i) : r();
  }
  function processVerbs(e, t, n) {
    let i = !1;
    return forEach(VERBS, function(r) {
      if (hasAttribute(e, "hx-" + r)) {
        const a = getAttributeValue(e, "hx-" + r);
        i = !0, t.path = a, t.verb = r, n.forEach(function(s) {
          addTriggerHandler(e, s, t, function(o, l) {
            const c = asElement(o);
            if (eltIsDisabled(c)) {
              cleanUpElement(c);
              return;
            }
            issueAjaxRequest(r, a, c, l);
          });
        });
      }
    }), i;
  }
  function addTriggerHandler(e, t, n, i) {
    if (t.trigger === "revealed")
      initScrollHandler(), addEventListener(e, i, n, t), maybeReveal(asElement(e));
    else if (t.trigger === "intersect") {
      const r = {};
      t.root && (r.root = querySelectorExt(e, t.root)), t.threshold && (r.threshold = parseFloat(t.threshold)), new IntersectionObserver(function(s) {
        for (let o = 0; o < s.length; o++)
          if (s[o].isIntersecting) {
            triggerEvent(e, "intersect");
            break;
          }
      }, r).observe(asElement(e)), addEventListener(asElement(e), i, n, t);
    } else !n.firstInitCompleted && t.trigger === "load" ? maybeFilterEvent(t, e, makeEvent("load", { elt: e })) || loadImmediately(asElement(e), i, n, t.delay) : t.pollInterval > 0 ? (n.polling = !0, processPolling(asElement(e), i, t)) : addEventListener(e, i, n, t);
  }
  function shouldProcessHxOn(e) {
    const t = asElement(e);
    if (!t)
      return !1;
    const n = t.attributes;
    for (let i = 0; i < n.length; i++) {
      const r = n[i].name;
      if (startsWith(r, "hx-on:") || startsWith(r, "data-hx-on:") || startsWith(r, "hx-on-") || startsWith(r, "data-hx-on-"))
        return !0;
    }
    return !1;
  }
  const HX_ON_QUERY = new XPathEvaluator().createExpression('.//*[@*[ starts-with(name(), "hx-on:") or starts-with(name(), "data-hx-on:") or starts-with(name(), "hx-on-") or starts-with(name(), "data-hx-on-") ]]');
  function processHXOnRoot(e, t) {
    shouldProcessHxOn(e) && t.push(asElement(e));
    const n = HX_ON_QUERY.evaluate(e);
    let i = null;
    for (; i = n.iterateNext(); ) t.push(asElement(i));
  }
  function findHxOnWildcardElements(e) {
    const t = [];
    if (e instanceof DocumentFragment)
      for (const n of e.childNodes)
        processHXOnRoot(n, t);
    else
      processHXOnRoot(e, t);
    return t;
  }
  function findElementsToProcess(e) {
    if (e.querySelectorAll) {
      const n = ", [hx-boost] a, [data-hx-boost] a, a[hx-boost], a[data-hx-boost]", i = [];
      for (const a in extensions) {
        const s = extensions[a];
        if (s.getSelectors) {
          var t = s.getSelectors();
          t && i.push(t);
        }
      }
      return e.querySelectorAll(VERB_SELECTOR + n + ", form, [type='submit'], [hx-ext], [data-hx-ext], [hx-trigger], [data-hx-trigger]" + i.flat().map((a) => ", " + a).join(""));
    } else
      return [];
  }
  function maybeSetLastButtonClicked(e) {
    const t = getTargetButton(e.target), n = getRelatedFormData(e);
    n && (n.lastButtonClicked = t);
  }
  function maybeUnsetLastButtonClicked(e) {
    const t = getRelatedFormData(e);
    t && (t.lastButtonClicked = null);
  }
  function getTargetButton(e) {
    return (
      /** @type {HTMLButtonElement|HTMLInputElement|null} */
      closest(asElement(e), "button, input[type='submit']")
    );
  }
  function getRelatedForm(e) {
    return e.form || closest(e, "form");
  }
  function getRelatedFormData(e) {
    const t = getTargetButton(e.target);
    if (!t)
      return;
    const n = getRelatedForm(t);
    if (n)
      return getInternalData(n);
  }
  function initButtonTracking(e) {
    e.addEventListener("click", maybeSetLastButtonClicked), e.addEventListener("focusin", maybeSetLastButtonClicked), e.addEventListener("focusout", maybeUnsetLastButtonClicked);
  }
  function addHxOnEventHandler(e, t, n) {
    const i = getInternalData(e);
    Array.isArray(i.onHandlers) || (i.onHandlers = []);
    let r;
    const a = function(s) {
      maybeEval(e, function() {
        eltIsDisabled(e) || (r || (r = new Function("event", n)), r.call(e, s));
      });
    };
    e.addEventListener(t, a), i.onHandlers.push({ event: t, listener: a });
  }
  function processHxOnWildcard(e) {
    deInitOnHandlers(e);
    for (let t = 0; t < e.attributes.length; t++) {
      const n = e.attributes[t].name, i = e.attributes[t].value;
      if (startsWith(n, "hx-on") || startsWith(n, "data-hx-on")) {
        const r = n.indexOf("-on") + 3, a = n.slice(r, r + 1);
        if (a === "-" || a === ":") {
          let s = n.slice(r + 1);
          startsWith(s, ":") ? s = "htmx" + s : startsWith(s, "-") ? s = "htmx:" + s.slice(1) : startsWith(s, "htmx-") && (s = "htmx:" + s.slice(5)), addHxOnEventHandler(e, s, i);
        }
      }
    }
  }
  function initNode(e) {
    triggerEvent(e, "htmx:beforeProcessNode");
    const t = getInternalData(e), n = getTriggerSpecs(e);
    processVerbs(e, t, n) || (getClosestAttributeValue(e, "hx-boost") === "true" ? boostElement(e, t, n) : hasAttribute(e, "hx-trigger") && n.forEach(function(r) {
      addTriggerHandler(e, r, t, function() {
      });
    })), (e.tagName === "FORM" || getRawAttribute(e, "type") === "submit" && hasAttribute(e, "form")) && initButtonTracking(e), t.firstInitCompleted = !0, triggerEvent(e, "htmx:afterProcessNode");
  }
  function maybeDeInitAndHash(e) {
    if (!(e instanceof Element))
      return !1;
    const t = getInternalData(e), n = attributeHash(e);
    return t.initHash !== n ? (deInitNode(e), t.initHash = n, !0) : !1;
  }
  function processNode(e) {
    if (e = resolveTarget(e), eltIsDisabled(e)) {
      cleanUpElement(e);
      return;
    }
    const t = [];
    maybeDeInitAndHash(e) && t.push(e), forEach(findElementsToProcess(e), function(n) {
      if (eltIsDisabled(n)) {
        cleanUpElement(n);
        return;
      }
      maybeDeInitAndHash(n) && t.push(n);
    }), forEach(findHxOnWildcardElements(e), processHxOnWildcard), forEach(t, initNode);
  }
  function kebabEventName(e) {
    return e.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  }
  function makeEvent(e, t) {
    return new CustomEvent(e, { bubbles: !0, cancelable: !0, composed: !0, detail: t });
  }
  function triggerErrorEvent(e, t, n) {
    triggerEvent(e, t, mergeObjects({ error: t }, n));
  }
  function ignoreEventForLogging(e) {
    return e === "htmx:afterProcessNode";
  }
  function withExtensions(e, t, n) {
    forEach(getExtensions(e, [], n), function(i) {
      try {
        t(i);
      } catch (r) {
        logError(r);
      }
    });
  }
  function logError(e) {
    console.error(e);
  }
  function triggerEvent(e, t, n) {
    e = resolveTarget(e), n == null && (n = {}), n.elt = e;
    const i = makeEvent(t, n);
    htmx.logger && !ignoreEventForLogging(t) && htmx.logger(e, t, n), n.error && (logError(n.error), triggerEvent(e, "htmx:error", { errorInfo: n }));
    let r = e.dispatchEvent(i);
    const a = kebabEventName(t);
    if (r && a !== t) {
      const s = makeEvent(a, i.detail);
      r = r && e.dispatchEvent(s);
    }
    return withExtensions(asElement(e), function(s) {
      r = r && s.onEvent(t, i) !== !1 && !i.defaultPrevented;
    }), r;
  }
  let currentPathForHistory;
  function setCurrentPathForHistory(e) {
    currentPathForHistory = e, canAccessLocalStorage() && sessionStorage.setItem("htmx-current-path-for-history", e);
  }
  setCurrentPathForHistory(location.pathname + location.search);
  function getHistoryElement() {
    return getDocument().querySelector("[hx-history-elt],[data-hx-history-elt]") || getDocument().body;
  }
  function saveToHistoryCache(e, t) {
    if (!canAccessLocalStorage())
      return;
    const n = cleanInnerHtmlForHistory(t), i = getDocument().title, r = window.scrollY;
    if (htmx.config.historyCacheSize <= 0) {
      sessionStorage.removeItem("htmx-history-cache");
      return;
    }
    e = normalizePath(e);
    const a = parseJSON(sessionStorage.getItem("htmx-history-cache")) || [];
    for (let o = 0; o < a.length; o++)
      if (a[o].url === e) {
        a.splice(o, 1);
        break;
      }
    const s = { url: e, content: n, title: i, scroll: r };
    for (triggerEvent(getDocument().body, "htmx:historyItemCreated", { item: s, cache: a }), a.push(s); a.length > htmx.config.historyCacheSize; )
      a.shift();
    for (; a.length > 0; )
      try {
        sessionStorage.setItem("htmx-history-cache", JSON.stringify(a));
        break;
      } catch (o) {
        triggerErrorEvent(getDocument().body, "htmx:historyCacheError", { cause: o, cache: a }), a.shift();
      }
  }
  function getCachedHistory(e) {
    if (!canAccessLocalStorage())
      return null;
    e = normalizePath(e);
    const t = parseJSON(sessionStorage.getItem("htmx-history-cache")) || [];
    for (let n = 0; n < t.length; n++)
      if (t[n].url === e)
        return t[n];
    return null;
  }
  function cleanInnerHtmlForHistory(e) {
    const t = htmx.config.requestClass, n = (
      /** @type Element */
      e.cloneNode(!0)
    );
    return forEach(findAll(n, "." + t), function(i) {
      removeClassFromElement(i, t);
    }), forEach(findAll(n, "[data-disabled-by-htmx]"), function(i) {
      i.removeAttribute("disabled");
    }), n.innerHTML;
  }
  function saveCurrentPageToHistory() {
    const e = getHistoryElement();
    let t = currentPathForHistory;
    canAccessLocalStorage() && (t = sessionStorage.getItem("htmx-current-path-for-history")), t = t || location.pathname + location.search, getDocument().querySelector('[hx-history="false" i],[data-hx-history="false" i]') || (triggerEvent(getDocument().body, "htmx:beforeHistorySave", { path: t, historyElt: e }), saveToHistoryCache(t, e)), htmx.config.historyEnabled && history.replaceState({ htmx: !0 }, getDocument().title, location.href);
  }
  function pushUrlIntoHistory(e) {
    htmx.config.getCacheBusterParam && (e = e.replace(/org\.htmx\.cache-buster=[^&]*&?/, ""), (endsWith(e, "&") || endsWith(e, "?")) && (e = e.slice(0, -1))), htmx.config.historyEnabled && history.pushState({ htmx: !0 }, "", e), setCurrentPathForHistory(e);
  }
  function replaceUrlInHistory(e) {
    htmx.config.historyEnabled && history.replaceState({ htmx: !0 }, "", e), setCurrentPathForHistory(e);
  }
  function settleImmediately(e) {
    forEach(e, function(t) {
      t.call(void 0);
    });
  }
  function loadHistoryFromServer(e) {
    const t = new XMLHttpRequest(), n = { swapStyle: "innerHTML", swapDelay: 0, settleDelay: 0 }, i = { path: e, xhr: t, historyElt: getHistoryElement(), swapSpec: n };
    t.open("GET", e, !0), htmx.config.historyRestoreAsHxRequest && t.setRequestHeader("HX-Request", "true"), t.setRequestHeader("HX-History-Restore-Request", "true"), t.setRequestHeader("HX-Current-URL", location.href), t.onload = function() {
      this.status >= 200 && this.status < 400 ? (i.response = this.response, triggerEvent(getDocument().body, "htmx:historyCacheMissLoad", i), swap(i.historyElt, i.response, n, {
        contextElement: i.historyElt,
        historyRequest: !0
      }), setCurrentPathForHistory(i.path), triggerEvent(getDocument().body, "htmx:historyRestore", { path: e, cacheMiss: !0, serverResponse: i.response })) : triggerErrorEvent(getDocument().body, "htmx:historyCacheMissLoadError", i);
    }, triggerEvent(getDocument().body, "htmx:historyCacheMiss", i) && t.send();
  }
  function restoreHistory(e) {
    saveCurrentPageToHistory(), e = e || location.pathname + location.search;
    const t = getCachedHistory(e);
    if (t) {
      const n = { swapStyle: "innerHTML", swapDelay: 0, settleDelay: 0, scroll: t.scroll }, i = { path: e, item: t, historyElt: getHistoryElement(), swapSpec: n };
      triggerEvent(getDocument().body, "htmx:historyCacheHit", i) && (swap(i.historyElt, t.content, n, {
        contextElement: i.historyElt,
        title: t.title
      }), setCurrentPathForHistory(i.path), triggerEvent(getDocument().body, "htmx:historyRestore", i));
    } else
      htmx.config.refreshOnHistoryMiss ? htmx.location.reload(!0) : loadHistoryFromServer(e);
  }
  function addRequestIndicatorClasses(e) {
    let t = (
      /** @type Element[] */
      findAttributeTargets(e, "hx-indicator")
    );
    return t == null && (t = [e]), forEach(t, function(n) {
      const i = getInternalData(n);
      i.requestCount = (i.requestCount || 0) + 1, n.classList.add.call(n.classList, htmx.config.requestClass);
    }), t;
  }
  function disableElements(e) {
    let t = (
      /** @type Element[] */
      findAttributeTargets(e, "hx-disabled-elt")
    );
    return t == null && (t = []), forEach(t, function(n) {
      const i = getInternalData(n);
      i.requestCount = (i.requestCount || 0) + 1, n.setAttribute("disabled", ""), n.setAttribute("data-disabled-by-htmx", "");
    }), t;
  }
  function removeRequestIndicators(e, t) {
    forEach(e.concat(t), function(n) {
      const i = getInternalData(n);
      i.requestCount = (i.requestCount || 1) - 1;
    }), forEach(e, function(n) {
      getInternalData(n).requestCount === 0 && n.classList.remove.call(n.classList, htmx.config.requestClass);
    }), forEach(t, function(n) {
      getInternalData(n).requestCount === 0 && (n.removeAttribute("disabled"), n.removeAttribute("data-disabled-by-htmx"));
    });
  }
  function haveSeenNode(e, t) {
    for (let n = 0; n < e.length; n++)
      if (e[n].isSameNode(t))
        return !0;
    return !1;
  }
  function shouldInclude(e) {
    const t = (
      /** @type {HTMLInputElement} */
      e
    );
    return t.name === "" || t.name == null || t.disabled || closest(t, "fieldset[disabled]") || t.type === "button" || t.type === "submit" || t.tagName === "image" || t.tagName === "reset" || t.tagName === "file" ? !1 : t.type === "checkbox" || t.type === "radio" ? t.checked : !0;
  }
  function addValueToFormData(e, t, n) {
    e != null && t != null && (Array.isArray(t) ? t.forEach(function(i) {
      n.append(e, i);
    }) : n.append(e, t));
  }
  function removeValueFromFormData(e, t, n) {
    if (e != null && t != null) {
      let i = n.getAll(e);
      Array.isArray(t) ? i = i.filter((r) => t.indexOf(r) < 0) : i = i.filter((r) => r !== t), n.delete(e), forEach(i, (r) => n.append(e, r));
    }
  }
  function getValueFromInput(e) {
    return e instanceof HTMLSelectElement && e.multiple ? toArray(e.querySelectorAll("option:checked")).map(function(t) {
      return (
        /** @type HTMLOptionElement */
        t.value
      );
    }) : e instanceof HTMLInputElement && e.files ? toArray(e.files) : e.value;
  }
  function processInputValue(e, t, n, i, r) {
    if (!(i == null || haveSeenNode(e, i))) {
      if (e.push(i), shouldInclude(i)) {
        const a = getRawAttribute(i, "name");
        addValueToFormData(a, getValueFromInput(i), t), r && validateElement(i, n);
      }
      i instanceof HTMLFormElement && (forEach(i.elements, function(a) {
        e.indexOf(a) >= 0 ? removeValueFromFormData(a.name, getValueFromInput(a), t) : e.push(a), r && validateElement(a, n);
      }), new FormData(i).forEach(function(a, s) {
        a instanceof File && a.name === "" || addValueToFormData(s, a, t);
      }));
    }
  }
  function validateElement(e, t) {
    const n = (
      /** @type {HTMLElement & ElementInternals} */
      e
    );
    n.willValidate && (triggerEvent(n, "htmx:validation:validate"), n.checkValidity() || (triggerEvent(n, "htmx:validation:failed", {
      message: n.validationMessage,
      validity: n.validity
    }) && !t.length && htmx.config.reportValidityOfForms && n.reportValidity(), t.push({ elt: n, message: n.validationMessage, validity: n.validity })));
  }
  function overrideFormData(e, t) {
    for (const n of t.keys())
      e.delete(n);
    return t.forEach(function(n, i) {
      e.append(i, n);
    }), e;
  }
  function getInputValues(e, t) {
    const n = [], i = new FormData(), r = new FormData(), a = [], s = getInternalData(e);
    s.lastButtonClicked && !bodyContains(s.lastButtonClicked) && (s.lastButtonClicked = null);
    let o = e instanceof HTMLFormElement && e.noValidate !== !0 || getAttributeValue(e, "hx-validate") === "true";
    if (s.lastButtonClicked && (o = o && s.lastButtonClicked.formNoValidate !== !0), t !== "get" && processInputValue(n, r, a, getRelatedForm(e), o), processInputValue(n, i, a, e, o), s.lastButtonClicked || e.tagName === "BUTTON" || e.tagName === "INPUT" && getRawAttribute(e, "type") === "submit") {
      const c = s.lastButtonClicked || /** @type HTMLInputElement|HTMLButtonElement */
      e, u = getRawAttribute(c, "name");
      addValueToFormData(u, c.value, r);
    }
    const l = findAttributeTargets(e, "hx-include");
    return forEach(l, function(c) {
      processInputValue(n, i, a, asElement(c), o), matches(c, "form") || forEach(asParentNode(c).querySelectorAll(INPUT_SELECTOR), function(u) {
        processInputValue(n, i, a, u, o);
      });
    }), overrideFormData(i, r), { errors: a, formData: i, values: formDataProxy(i) };
  }
  function appendParam(e, t, n) {
    e !== "" && (e += "&"), String(n) === "[object Object]" && (n = JSON.stringify(n));
    const i = encodeURIComponent(n);
    return e += encodeURIComponent(t) + "=" + i, e;
  }
  function urlEncode(e) {
    e = formDataFromObject(e);
    let t = "";
    return e.forEach(function(n, i) {
      t = appendParam(t, i, n);
    }), t;
  }
  function getHeaders(e, t, n) {
    const i = {
      "HX-Request": "true",
      "HX-Trigger": getRawAttribute(e, "id"),
      "HX-Trigger-Name": getRawAttribute(e, "name"),
      "HX-Target": getAttributeValue(t, "id"),
      "HX-Current-URL": location.href
    };
    return getValuesForElement(e, "hx-headers", !1, i), n !== void 0 && (i["HX-Prompt"] = n), getInternalData(e).boosted && (i["HX-Boosted"] = "true"), i;
  }
  function filterValues(e, t) {
    const n = getClosestAttributeValue(t, "hx-params");
    if (n) {
      if (n === "none")
        return new FormData();
      if (n === "*")
        return e;
      if (n.indexOf("not ") === 0)
        return forEach(n.slice(4).split(","), function(i) {
          i = i.trim(), e.delete(i);
        }), e;
      {
        const i = new FormData();
        return forEach(n.split(","), function(r) {
          r = r.trim(), e.has(r) && e.getAll(r).forEach(function(a) {
            i.append(r, a);
          });
        }), i;
      }
    } else
      return e;
  }
  function isAnchorLink(e) {
    return !!getRawAttribute(e, "href") && getRawAttribute(e, "href").indexOf("#") >= 0;
  }
  function getSwapSpecification(e, t) {
    const n = t || getClosestAttributeValue(e, "hx-swap"), i = {
      swapStyle: getInternalData(e).boosted ? "innerHTML" : htmx.config.defaultSwapStyle,
      swapDelay: htmx.config.defaultSwapDelay,
      settleDelay: htmx.config.defaultSettleDelay
    };
    if (htmx.config.scrollIntoViewOnBoost && getInternalData(e).boosted && !isAnchorLink(e) && (i.show = "top"), n) {
      const s = splitOnWhitespace(n);
      if (s.length > 0)
        for (let o = 0; o < s.length; o++) {
          const l = s[o];
          if (l.indexOf("swap:") === 0)
            i.swapDelay = parseInterval(l.slice(5));
          else if (l.indexOf("settle:") === 0)
            i.settleDelay = parseInterval(l.slice(7));
          else if (l.indexOf("transition:") === 0)
            i.transition = l.slice(11) === "true";
          else if (l.indexOf("ignoreTitle:") === 0)
            i.ignoreTitle = l.slice(12) === "true";
          else if (l.indexOf("scroll:") === 0) {
            var r = l.slice(7).split(":");
            const u = r.pop();
            var a = r.length > 0 ? r.join(":") : null;
            i.scroll = u, i.scrollTarget = a;
          } else if (l.indexOf("show:") === 0) {
            var r = l.slice(5).split(":");
            const d = r.pop();
            var a = r.length > 0 ? r.join(":") : null;
            i.show = d, i.showTarget = a;
          } else if (l.indexOf("focus-scroll:") === 0) {
            const c = l.slice(13);
            i.focusScroll = c == "true";
          } else o == 0 ? i.swapStyle = l : logError("Unknown modifier in hx-swap: " + l);
        }
    }
    return i;
  }
  function usesFormData(e) {
    return getClosestAttributeValue(e, "hx-encoding") === "multipart/form-data" || matches(e, "form") && getRawAttribute(e, "enctype") === "multipart/form-data";
  }
  function encodeParamsForBody(e, t, n) {
    let i = null;
    return withExtensions(t, function(r) {
      i == null && (i = r.encodeParameters(e, n, t));
    }), i ?? (usesFormData(t) ? overrideFormData(new FormData(), formDataFromObject(n)) : urlEncode(n));
  }
  function makeSettleInfo(e) {
    return { tasks: [], elts: [e] };
  }
  function updateScrollState(e, t) {
    const n = e[0], i = e[e.length - 1];
    if (t.scroll) {
      var r = null;
      t.scrollTarget && (r = asElement(querySelectorExt(n, t.scrollTarget))), t.scroll === "top" && (n || r) && (r = r || n, r.scrollTop = 0), t.scroll === "bottom" && (i || r) && (r = r || i, r.scrollTop = r.scrollHeight), typeof t.scroll == "number" && getWindow().setTimeout(function() {
        window.scrollTo(
          0,
          /** @type number */
          t.scroll
        );
      }, 0);
    }
    if (t.show) {
      var r = null;
      if (t.showTarget) {
        let s = t.showTarget;
        t.showTarget === "window" && (s = "body"), r = asElement(querySelectorExt(n, s));
      }
      t.show === "top" && (n || r) && (r = r || n, r.scrollIntoView({ block: "start", behavior: htmx.config.scrollBehavior })), t.show === "bottom" && (i || r) && (r = r || i, r.scrollIntoView({ block: "end", behavior: htmx.config.scrollBehavior }));
    }
  }
  function getValuesForElement(e, t, n, i, r) {
    if (i == null && (i = {}), e == null)
      return i;
    const a = getAttributeValue(e, t);
    if (a) {
      let s = a.trim(), o = n;
      if (s === "unset")
        return null;
      s.indexOf("javascript:") === 0 ? (s = s.slice(11), o = !0) : s.indexOf("js:") === 0 && (s = s.slice(3), o = !0), s.indexOf("{") !== 0 && (s = "{" + s + "}");
      let l;
      o ? l = maybeEval(e, function() {
        return r ? Function("event", "return (" + s + ")").call(e, r) : Function("return (" + s + ")").call(e);
      }, {}) : l = parseJSON(s);
      for (const c in l)
        l.hasOwnProperty(c) && i[c] == null && (i[c] = l[c]);
    }
    return getValuesForElement(asElement(parentElt(e)), t, n, i, r);
  }
  function maybeEval(e, t, n) {
    return htmx.config.allowEval ? t() : (triggerErrorEvent(e, "htmx:evalDisallowedError"), n);
  }
  function getHXVarsForElement(e, t, n) {
    return getValuesForElement(e, "hx-vars", !0, n, t);
  }
  function getHXValsForElement(e, t, n) {
    return getValuesForElement(e, "hx-vals", !1, n, t);
  }
  function getExpressionVars(e, t) {
    return mergeObjects(getHXVarsForElement(e, t), getHXValsForElement(e, t));
  }
  function safelySetHeaderValue(e, t, n) {
    if (n !== null)
      try {
        e.setRequestHeader(t, n);
      } catch {
        e.setRequestHeader(t, encodeURIComponent(n)), e.setRequestHeader(t + "-URI-AutoEncoded", "true");
      }
  }
  function getPathFromResponse(e) {
    if (e.responseURL)
      try {
        const t = new URL(e.responseURL);
        return t.pathname + t.search;
      } catch {
        triggerErrorEvent(getDocument().body, "htmx:badResponseUrl", { url: e.responseURL });
      }
  }
  function hasHeader(e, t) {
    return t.test(e.getAllResponseHeaders());
  }
  function ajaxHelper(e, t, n) {
    if (e = /** @type HttpVerb */
    e.toLowerCase(), n) {
      if (n instanceof Element || typeof n == "string")
        return issueAjaxRequest(e, t, null, null, {
          targetOverride: resolveTarget(n) || DUMMY_ELT,
          returnPromise: !0
        });
      {
        let i = resolveTarget(n.target);
        return (n.target && !i || n.source && !i && !resolveTarget(n.source)) && (i = DUMMY_ELT), issueAjaxRequest(
          e,
          t,
          resolveTarget(n.source),
          n.event,
          {
            handler: n.handler,
            headers: n.headers,
            values: n.values,
            targetOverride: i,
            swapOverride: n.swap,
            select: n.select,
            returnPromise: !0,
            push: n.push,
            replace: n.replace,
            selectOOB: n.selectOOB
          }
        );
      }
    } else
      return issueAjaxRequest(e, t, null, null, {
        returnPromise: !0
      });
  }
  function hierarchyForElt(e) {
    const t = [];
    for (; e; )
      t.push(e), e = e.parentElement;
    return t;
  }
  function verifyPath(e, t, n) {
    const i = new URL(t, location.protocol !== "about:" ? location.href : window.origin), a = (location.protocol !== "about:" ? location.origin : window.origin) === i.origin;
    return htmx.config.selfRequestsOnly && !a ? !1 : triggerEvent(e, "htmx:validateUrl", mergeObjects({ url: i, sameHost: a }, n));
  }
  function formDataFromObject(e) {
    if (e instanceof FormData) return e;
    const t = new FormData();
    for (const n in e)
      e.hasOwnProperty(n) && (e[n] && typeof e[n].forEach == "function" ? e[n].forEach(function(i) {
        t.append(n, i);
      }) : typeof e[n] == "object" && !(e[n] instanceof Blob) ? t.append(n, JSON.stringify(e[n])) : t.append(n, e[n]));
    return t;
  }
  function formDataArrayProxy(e, t, n) {
    return new Proxy(n, {
      get: function(i, r) {
        return typeof r == "number" ? i[r] : r === "length" ? i.length : r === "push" ? function(a) {
          i.push(a), e.append(t, a);
        } : typeof i[r] == "function" ? function() {
          i[r].apply(i, arguments), e.delete(t), i.forEach(function(a) {
            e.append(t, a);
          });
        } : i[r] && i[r].length === 1 ? i[r][0] : i[r];
      },
      set: function(i, r, a) {
        return i[r] = a, e.delete(t), i.forEach(function(s) {
          e.append(t, s);
        }), !0;
      }
    });
  }
  function formDataProxy(e) {
    return new Proxy(e, {
      get: function(t, n) {
        if (typeof n == "symbol") {
          const r = Reflect.get(t, n);
          return typeof r == "function" ? function() {
            return r.apply(e, arguments);
          } : r;
        }
        if (n === "toJSON")
          return () => Object.fromEntries(e);
        if (n in t && typeof t[n] == "function")
          return function() {
            return e[n].apply(e, arguments);
          };
        const i = e.getAll(n);
        if (i.length !== 0)
          return i.length === 1 ? i[0] : formDataArrayProxy(t, n, i);
      },
      set: function(t, n, i) {
        return typeof n != "string" ? !1 : (t.delete(n), i && typeof i.forEach == "function" ? i.forEach(function(r) {
          t.append(n, r);
        }) : typeof i == "object" && !(i instanceof Blob) ? t.append(n, JSON.stringify(i)) : t.append(n, i), !0);
      },
      deleteProperty: function(t, n) {
        return typeof n == "string" && t.delete(n), !0;
      },
      // Support Object.assign call from proxy
      ownKeys: function(t) {
        return Reflect.ownKeys(Object.fromEntries(t));
      },
      getOwnPropertyDescriptor: function(t, n) {
        return Reflect.getOwnPropertyDescriptor(Object.fromEntries(t), n);
      }
    });
  }
  function issueAjaxRequest(e, t, n, i, r, a) {
    let s = null, o = null;
    if (r = r ?? {}, r.returnPromise && typeof Promise < "u")
      var l = new Promise(function(k, M) {
        s = k, o = M;
      });
    n == null && (n = getDocument().body);
    const c = r.handler || handleAjaxResponse, u = r.select || null;
    if (!bodyContains(n))
      return maybeCall(s), l;
    const d = r.targetOverride || asElement(getTarget(n));
    if (d == null || d == DUMMY_ELT)
      return triggerErrorEvent(n, "htmx:targetError", { target: getClosestAttributeValue(n, "hx-target") }), maybeCall(o), l;
    let h = getInternalData(n);
    const b = h.lastButtonClicked;
    if (b) {
      const k = getRawAttribute(b, "formaction");
      k != null && (t = k);
      const M = getRawAttribute(b, "formmethod");
      if (M != null)
        if (VERBS.includes(M.toLowerCase()))
          e = /** @type HttpVerb */
          M;
        else
          return maybeCall(s), l;
    }
    const v = getClosestAttributeValue(n, "hx-confirm");
    if (a === void 0 && triggerEvent(n, "htmx:confirm", { target: d, elt: n, path: t, verb: e, triggeringEvent: i, etc: r, issueRequest: function(F) {
      return issueAjaxRequest(e, t, n, i, r, !!F);
    }, question: v }) === !1)
      return maybeCall(s), l;
    let x = n, m = getClosestAttributeValue(n, "hx-sync"), E = null, g = !1;
    if (m) {
      const k = m.split(":"), M = k[0].trim();
      if (M === "this" ? x = findThisElement(n, "hx-sync") : x = asElement(querySelectorExt(n, M)), m = (k[1] || "drop").trim(), h = getInternalData(x), m === "drop" && h.xhr && h.abortable !== !0)
        return maybeCall(s), l;
      if (m === "abort") {
        if (h.xhr)
          return maybeCall(s), l;
        g = !0;
      } else m === "replace" ? triggerEvent(x, "htmx:abort") : m.indexOf("queue") === 0 && (E = (m.split(" ")[1] || "last").trim());
    }
    if (h.xhr)
      if (h.abortable)
        triggerEvent(x, "htmx:abort");
      else {
        if (E == null) {
          if (i) {
            const k = getInternalData(i);
            k && k.triggerSpec && k.triggerSpec.queue && (E = k.triggerSpec.queue);
          }
          E == null && (E = "last");
        }
        return h.queuedRequests == null && (h.queuedRequests = []), E === "first" && h.queuedRequests.length === 0 ? h.queuedRequests.push(function() {
          issueAjaxRequest(e, t, n, i, r);
        }) : E === "all" ? h.queuedRequests.push(function() {
          issueAjaxRequest(e, t, n, i, r);
        }) : E === "last" && (h.queuedRequests = [], h.queuedRequests.push(function() {
          issueAjaxRequest(e, t, n, i, r);
        })), maybeCall(s), l;
      }
    const y = new XMLHttpRequest();
    h.xhr = y, h.abortable = g;
    const f = function() {
      h.xhr = null, h.abortable = !1, h.queuedRequests != null && h.queuedRequests.length > 0 && h.queuedRequests.shift()();
    }, p = getClosestAttributeValue(n, "hx-prompt");
    if (p) {
      var _ = prompt(p);
      if (_ === null || !triggerEvent(n, "htmx:prompt", { prompt: _, target: d }))
        return maybeCall(s), f(), l;
    }
    if (v && !a && !confirm(v))
      return maybeCall(s), f(), l;
    let w = getHeaders(n, d, _);
    e !== "get" && !usesFormData(n) && (w["Content-Type"] = "application/x-www-form-urlencoded"), r.headers && (w = mergeObjects(w, r.headers));
    const D = getInputValues(n, e);
    let A = D.errors;
    const C = D.formData;
    r.values && overrideFormData(C, formDataFromObject(r.values));
    const S = formDataFromObject(getExpressionVars(n, i)), O = overrideFormData(C, S);
    let T = filterValues(O, n);
    htmx.config.getCacheBusterParam && e === "get" && T.set("org.htmx.cache-buster", getRawAttribute(d, "id") || "true"), (t == null || t === "") && (t = location.href);
    const L = getValuesForElement(n, "hx-request"), R = getInternalData(n).boosted;
    let H = htmx.config.methodsThatUseUrlParams.indexOf(e) >= 0;
    const I = {
      boosted: R,
      useUrlParams: H,
      formData: T,
      parameters: formDataProxy(T),
      unfilteredFormData: O,
      unfilteredParameters: formDataProxy(O),
      headers: w,
      elt: n,
      target: d,
      verb: e,
      errors: A,
      withCredentials: r.credentials || L.credentials || htmx.config.withCredentials,
      timeout: r.timeout || L.timeout || htmx.config.timeout,
      path: t,
      triggeringEvent: i
    };
    if (!triggerEvent(n, "htmx:configRequest", I))
      return maybeCall(s), f(), l;
    if (t = I.path, e = I.verb, w = I.headers, T = formDataFromObject(I.parameters), A = I.errors, H = I.useUrlParams, A && A.length > 0)
      return triggerEvent(n, "htmx:validation:halted", I), maybeCall(s), f(), l;
    const W = t.split("#"), $ = W[0], q = W[1];
    let N = t;
    if (H && (N = $, !T.keys().next().done && (N.indexOf("?") < 0 ? N += "?" : N += "&", N += urlEncode(T), q && (N += "#" + q))), !verifyPath(n, N, I))
      return triggerErrorEvent(n, "htmx:invalidPath", I), maybeCall(o), f(), l;
    if (y.open(e.toUpperCase(), N, !0), y.overrideMimeType("text/html"), y.withCredentials = I.withCredentials, y.timeout = I.timeout, !L.noHeaders) {
      for (const k in w)
        if (w.hasOwnProperty(k)) {
          const M = w[k];
          safelySetHeaderValue(y, k, M);
        }
    }
    const P = {
      xhr: y,
      target: d,
      requestConfig: I,
      etc: r,
      boosted: R,
      select: u,
      pathInfo: {
        requestPath: t,
        finalRequestPath: N,
        responsePath: null,
        anchor: q
      }
    };
    if (y.onload = function() {
      try {
        const k = hierarchyForElt(n);
        if (P.pathInfo.responsePath = getPathFromResponse(y), c(n, P), P.keepIndicators !== !0 && removeRequestIndicators(j, V), triggerEvent(n, "htmx:afterRequest", P), triggerEvent(n, "htmx:afterOnLoad", P), !bodyContains(n)) {
          let M = null;
          for (; k.length > 0 && M == null; ) {
            const F = k.shift();
            bodyContains(F) && (M = F);
          }
          M && (triggerEvent(M, "htmx:afterRequest", P), triggerEvent(M, "htmx:afterOnLoad", P));
        }
        maybeCall(s);
      } catch (k) {
        throw triggerErrorEvent(n, "htmx:onLoadError", mergeObjects({ error: k }, P)), k;
      } finally {
        f();
      }
    }, y.onerror = function() {
      removeRequestIndicators(j, V), triggerErrorEvent(n, "htmx:afterRequest", P), triggerErrorEvent(n, "htmx:sendError", P), maybeCall(o), f();
    }, y.onabort = function() {
      removeRequestIndicators(j, V), triggerErrorEvent(n, "htmx:afterRequest", P), triggerErrorEvent(n, "htmx:sendAbort", P), maybeCall(o), f();
    }, y.ontimeout = function() {
      removeRequestIndicators(j, V), triggerErrorEvent(n, "htmx:afterRequest", P), triggerErrorEvent(n, "htmx:timeout", P), maybeCall(o), f();
    }, !triggerEvent(n, "htmx:beforeRequest", P))
      return maybeCall(s), f(), l;
    var j = addRequestIndicatorClasses(n), V = disableElements(n);
    forEach(["loadstart", "loadend", "progress", "abort"], function(k) {
      forEach([y, y.upload], function(M) {
        M.addEventListener(k, function(F) {
          triggerEvent(n, "htmx:xhr:" + k, {
            lengthComputable: F.lengthComputable,
            loaded: F.loaded,
            total: F.total
          });
        });
      });
    }), triggerEvent(n, "htmx:beforeSend", P);
    const B = H ? null : encodeParamsForBody(y, n, T);
    return y.send(B), l;
  }
  function determineHistoryUpdates(e, t) {
    const n = t.xhr;
    let i = null, r = null;
    if (hasHeader(n, /HX-Push:/i) ? (i = n.getResponseHeader("HX-Push"), r = "push") : hasHeader(n, /HX-Push-Url:/i) ? (i = n.getResponseHeader("HX-Push-Url"), r = "push") : hasHeader(n, /HX-Replace-Url:/i) && (i = n.getResponseHeader("HX-Replace-Url"), r = "replace"), i)
      return i === "false" ? {} : {
        type: r,
        path: i
      };
    const a = t.pathInfo.finalRequestPath, s = t.pathInfo.responsePath, o = t.etc.push || getClosestAttributeValue(e, "hx-push-url"), l = t.etc.replace || getClosestAttributeValue(e, "hx-replace-url"), c = getInternalData(e).boosted;
    let u = null, d = null;
    return o ? (u = "push", d = o) : l ? (u = "replace", d = l) : c && (u = "push", d = s || a), d ? d === "false" ? {} : (d === "true" && (d = s || a), t.pathInfo.anchor && d.indexOf("#") === -1 && (d = d + "#" + t.pathInfo.anchor), {
      type: u,
      path: d
    }) : {};
  }
  function codeMatches(e, t) {
    var n = new RegExp(e.code);
    return n.test(t.toString(10));
  }
  function resolveResponseHandling(e) {
    for (var t = 0; t < htmx.config.responseHandling.length; t++) {
      var n = htmx.config.responseHandling[t];
      if (codeMatches(n, e.status))
        return n;
    }
    return {
      swap: !1
    };
  }
  function handleTitle(e) {
    if (e) {
      const t = find("title");
      t ? t.textContent = e : window.document.title = e;
    }
  }
  function resolveRetarget(e, t) {
    if (t === "this")
      return e;
    const n = asElement(querySelectorExt(e, t));
    if (n == null)
      throw triggerErrorEvent(e, "htmx:targetError", { target: t }), new Error(`Invalid re-target ${t}`);
    return n;
  }
  function handleAjaxResponse(e, t) {
    const n = t.xhr;
    let i = t.target;
    const r = t.etc, a = t.select;
    if (!triggerEvent(e, "htmx:beforeOnLoad", t)) return;
    if (hasHeader(n, /HX-Trigger:/i) && handleTriggerHeader(n, "HX-Trigger", e), hasHeader(n, /HX-Location:/i)) {
      let g = n.getResponseHeader("HX-Location");
      var s = {};
      g.indexOf("{") === 0 && (s = parseJSON(g), g = s.path, delete s.path), s.push = s.push || "true", ajaxHelper("get", g, s);
      return;
    }
    const o = hasHeader(n, /HX-Refresh:/i) && n.getResponseHeader("HX-Refresh") === "true";
    if (hasHeader(n, /HX-Redirect:/i)) {
      t.keepIndicators = !0, htmx.location.href = n.getResponseHeader("HX-Redirect"), o && htmx.location.reload();
      return;
    }
    if (o) {
      t.keepIndicators = !0, htmx.location.reload();
      return;
    }
    const l = determineHistoryUpdates(e, t), c = resolveResponseHandling(n), u = c.swap;
    let d = !!c.error, h = htmx.config.ignoreTitle || c.ignoreTitle, b = c.select;
    c.target && (t.target = resolveRetarget(e, c.target));
    var v = r.swapOverride;
    v == null && c.swapOverride && (v = c.swapOverride), hasHeader(n, /HX-Retarget:/i) && (t.target = resolveRetarget(e, n.getResponseHeader("HX-Retarget"))), hasHeader(n, /HX-Reswap:/i) && (v = n.getResponseHeader("HX-Reswap"));
    var x = n.response, m = mergeObjects({
      shouldSwap: u,
      serverResponse: x,
      isError: d,
      ignoreTitle: h,
      selectOverride: b,
      swapOverride: v
    }, t);
    if (!(c.event && !triggerEvent(i, c.event, m)) && triggerEvent(i, "htmx:beforeSwap", m)) {
      if (i = m.target, x = m.serverResponse, d = m.isError, h = m.ignoreTitle, b = m.selectOverride, v = m.swapOverride, t.target = i, t.failed = d, t.successful = !d, m.shouldSwap) {
        n.status === 286 && cancelPolling(e), withExtensions(e, function(f) {
          x = f.transformResponse(x, n, e);
        }), l.type && saveCurrentPageToHistory();
        var E = getSwapSpecification(e, v);
        E.hasOwnProperty("ignoreTitle") || (E.ignoreTitle = h), i.classList.add(htmx.config.swappingClass), a && (b = a), hasHeader(n, /HX-Reselect:/i) && (b = n.getResponseHeader("HX-Reselect"));
        const g = r.selectOOB || getClosestAttributeValue(e, "hx-select-oob"), y = getClosestAttributeValue(e, "hx-select");
        swap(i, x, E, {
          select: b === "unset" ? null : b || y,
          selectOOB: g,
          eventInfo: t,
          anchor: t.pathInfo.anchor,
          contextElement: e,
          afterSwapCallback: function() {
            if (hasHeader(n, /HX-Trigger-After-Swap:/i)) {
              let f = e;
              bodyContains(e) || (f = getDocument().body), handleTriggerHeader(n, "HX-Trigger-After-Swap", f);
            }
          },
          afterSettleCallback: function() {
            if (hasHeader(n, /HX-Trigger-After-Settle:/i)) {
              let f = e;
              bodyContains(e) || (f = getDocument().body), handleTriggerHeader(n, "HX-Trigger-After-Settle", f);
            }
          },
          beforeSwapCallback: function() {
            l.type && (triggerEvent(getDocument().body, "htmx:beforeHistoryUpdate", mergeObjects({ history: l }, t)), l.type === "push" ? (pushUrlIntoHistory(l.path), triggerEvent(getDocument().body, "htmx:pushedIntoHistory", { path: l.path })) : (replaceUrlInHistory(l.path), triggerEvent(getDocument().body, "htmx:replacedInHistory", { path: l.path })));
          }
        });
      }
      d && triggerErrorEvent(e, "htmx:responseError", mergeObjects({ error: "Response Status Error Code " + n.status + " from " + t.pathInfo.requestPath }, t));
    }
  }
  const extensions = {};
  function extensionBase() {
    return {
      init: function(e) {
        return null;
      },
      getSelectors: function() {
        return null;
      },
      onEvent: function(e, t) {
        return !0;
      },
      transformResponse: function(e, t, n) {
        return e;
      },
      isInlineSwap: function(e) {
        return !1;
      },
      handleSwap: function(e, t, n, i) {
        return !1;
      },
      encodeParameters: function(e, t, n) {
        return null;
      }
    };
  }
  function defineExtension(e, t) {
    t.init && t.init(internalAPI), extensions[e] = mergeObjects(extensionBase(), t);
  }
  function removeExtension(e) {
    delete extensions[e];
  }
  function getExtensions(e, t, n) {
    if (t == null && (t = []), e == null)
      return t;
    n == null && (n = []);
    const i = getAttributeValue(e, "hx-ext");
    return i && forEach(i.split(","), function(r) {
      if (r = r.replace(/ /g, ""), r.slice(0, 7) == "ignore:") {
        n.push(r.slice(7));
        return;
      }
      if (n.indexOf(r) < 0) {
        const a = extensions[r];
        a && t.indexOf(a) < 0 && t.push(a);
      }
    }), getExtensions(asElement(parentElt(e)), t, n);
  }
  var isReady = !1;
  getDocument().addEventListener("DOMContentLoaded", function() {
    isReady = !0;
  });
  function ready(e) {
    isReady || getDocument().readyState === "complete" ? e() : getDocument().addEventListener("DOMContentLoaded", e);
  }
  function insertIndicatorStyles() {
    if (htmx.config.includeIndicatorStyles !== !1) {
      const e = htmx.config.inlineStyleNonce ? ` nonce="${htmx.config.inlineStyleNonce}"` : "", t = htmx.config.indicatorClass, n = htmx.config.requestClass;
      getDocument().head.insertAdjacentHTML(
        "beforeend",
        `<style${e}>.${t}{opacity:0;visibility: hidden} .${n} .${t}, .${n}.${t}{opacity:1;visibility: visible;transition: opacity 200ms ease-in}</style>`
      );
    }
  }
  function getMetaConfig() {
    const e = getDocument().querySelector('meta[name="htmx-config"]');
    return e ? parseJSON(e.content) : null;
  }
  function mergeMetaConfig() {
    const e = getMetaConfig();
    e && (htmx.config = mergeObjects(htmx.config, e));
  }
  return ready(function() {
    mergeMetaConfig(), insertIndicatorStyles();
    let e = getDocument().body;
    processNode(e);
    const t = getDocument().querySelectorAll(
      "[hx-trigger='restored'],[data-hx-trigger='restored']"
    );
    e.addEventListener("htmx:abort", function(i) {
      const r = (
        /** @type {CustomEvent} */
        i.detail.elt || i.target
      ), a = getInternalData(r);
      a && a.xhr && a.xhr.abort();
    });
    const n = window.onpopstate ? window.onpopstate.bind(window) : null;
    window.onpopstate = function(i) {
      i.state && i.state.htmx ? (restoreHistory(), forEach(t, function(r) {
        triggerEvent(r, "htmx:restored", {
          document: getDocument(),
          triggerEvent
        });
      })) : n && n(i);
    }, getWindow().setTimeout(function() {
      triggerEvent(e, "htmx:load", {}), e = null;
    }, 0);
  }), htmx;
})(), Idiomorph = (function() {
  const e = () => {
  }, t = {
    morphStyle: "outerHTML",
    callbacks: {
      beforeNodeAdded: e,
      afterNodeAdded: e,
      beforeNodeMorphed: e,
      afterNodeMorphed: e,
      beforeNodeRemoved: e,
      afterNodeRemoved: e,
      beforeAttributeUpdated: e
    },
    head: {
      style: "merge",
      shouldPreserve: (h) => h.getAttribute("im-preserve") === "true",
      shouldReAppend: (h) => h.getAttribute("im-re-append") === "true",
      shouldRemove: e,
      afterHeadMorphed: e
    },
    restoreFocus: !0
  };
  function n(h, b, v = {}) {
    h = u(h);
    const x = d(b), m = c(h, x, v), E = r(m, () => o(
      m,
      h,
      x,
      /** @param {MorphContext} ctx */
      (g) => g.morphStyle === "innerHTML" ? (a(g, h, x), Array.from(h.childNodes)) : i(g, h, x)
    ));
    return m.pantry.remove(), E;
  }
  function i(h, b, v) {
    const x = d(b);
    return a(
      h,
      x,
      v,
      // these two optional params are the secret sauce
      b,
      // start point for iteration
      b.nextSibling
      // end point for iteration
    ), Array.from(x.childNodes);
  }
  function r(h, b) {
    if (!h.config.restoreFocus) return b();
    let v = (
      /** @type {HTMLInputElement|HTMLTextAreaElement|null} */
      document.activeElement
    );
    if (!(v instanceof HTMLInputElement || v instanceof HTMLTextAreaElement))
      return b();
    const { id: x, selectionStart: m, selectionEnd: E } = v, g = b();
    return x && x !== document.activeElement?.getAttribute("id") && (v = h.target.querySelector(`[id="${x}"]`), v?.focus()), v && !v.selectionEnd && E && v.setSelectionRange(m, E), g;
  }
  const a = /* @__PURE__ */ (function() {
    function h(f, p, _, w = null, D = null) {
      p instanceof HTMLTemplateElement && _ instanceof HTMLTemplateElement && (p = p.content, _ = _.content), w ||= p.firstChild;
      for (const A of _.childNodes) {
        if (w && w != D) {
          const S = v(
            f,
            A,
            w,
            D
          );
          if (S) {
            S !== w && m(f, w, S), s(S, A, f), w = S.nextSibling;
            continue;
          }
        }
        if (A instanceof Element) {
          const S = (
            /** @type {String} */
            A.getAttribute("id")
          );
          if (f.persistentIds.has(S)) {
            const O = E(
              p,
              S,
              w,
              f
            );
            s(O, A, f), w = O.nextSibling;
            continue;
          }
        }
        const C = b(
          p,
          A,
          w,
          f
        );
        C && (w = C.nextSibling);
      }
      for (; w && w != D; ) {
        const A = w;
        w = w.nextSibling, x(f, A);
      }
    }
    function b(f, p, _, w) {
      if (w.callbacks.beforeNodeAdded(p) === !1) return null;
      if (w.idMap.has(p)) {
        const D = document.createElement(
          /** @type {Element} */
          p.tagName
        );
        return f.insertBefore(D, _), s(D, p, w), w.callbacks.afterNodeAdded(D), D;
      } else {
        const D = document.importNode(p, !0);
        return f.insertBefore(D, _), w.callbacks.afterNodeAdded(D), D;
      }
    }
    const v = /* @__PURE__ */ (function() {
      function f(w, D, A, C) {
        let S = null, O = D.nextSibling, T = 0, L = A;
        for (; L && L != C; ) {
          if (_(L, D)) {
            if (p(w, L, D))
              return L;
            S === null && (w.idMap.has(L) || (S = L));
          }
          if (S === null && O && _(L, O) && (T++, O = O.nextSibling, T >= 2 && (S = void 0)), w.activeElementAndParents.includes(L)) break;
          L = L.nextSibling;
        }
        return S || null;
      }
      function p(w, D, A) {
        let C = w.idMap.get(D), S = w.idMap.get(A);
        if (!S || !C) return !1;
        for (const O of C)
          if (S.has(O))
            return !0;
        return !1;
      }
      function _(w, D) {
        const A = (
          /** @type {Element} */
          w
        ), C = (
          /** @type {Element} */
          D
        );
        return A.nodeType === C.nodeType && A.tagName === C.tagName && // If oldElt has an `id` with possible state and it doesn't match newElt.id then avoid morphing.
        // We'll still match an anonymous node with an IDed newElt, though, because if it got this far,
        // its not persistent, and new nodes can't have any hidden state.
        // We can't use .id because of form input shadowing, and we can't count on .getAttribute's presence because it could be a document-fragment
        (!A.getAttribute?.("id") || A.getAttribute?.("id") === C.getAttribute?.("id"));
      }
      return f;
    })();
    function x(f, p) {
      if (f.idMap.has(p))
        y(f.pantry, p, null);
      else {
        if (f.callbacks.beforeNodeRemoved(p) === !1) return;
        p.parentNode?.removeChild(p), f.callbacks.afterNodeRemoved(p);
      }
    }
    function m(f, p, _) {
      let w = p;
      for (; w && w !== _; ) {
        let D = (
          /** @type {Node} */
          w
        );
        w = w.nextSibling, x(f, D);
      }
      return w;
    }
    function E(f, p, _, w) {
      const D = (
        /** @type {Element} - will always be found */
        // ctx.target.id unsafe because of form input shadowing
        // ctx.target could be a document fragment which doesn't have `getAttribute`
        w.target.getAttribute?.("id") === p && w.target || w.target.querySelector(`[id="${p}"]`) || w.pantry.querySelector(`[id="${p}"]`)
      );
      return g(D, w), y(f, D, _), D;
    }
    function g(f, p) {
      const _ = (
        /** @type {String} */
        f.getAttribute("id")
      );
      for (; f = f.parentNode; ) {
        let w = p.idMap.get(f);
        w && (w.delete(_), w.size || p.idMap.delete(f));
      }
    }
    function y(f, p, _) {
      if (f.moveBefore)
        try {
          f.moveBefore(p, _);
        } catch {
          f.insertBefore(p, _);
        }
      else
        f.insertBefore(p, _);
    }
    return h;
  })(), s = /* @__PURE__ */ (function() {
    function h(g, y, f) {
      return f.ignoreActive && g === document.activeElement ? null : (f.callbacks.beforeNodeMorphed(g, y) === !1 || (g instanceof HTMLHeadElement && f.head.ignore || (g instanceof HTMLHeadElement && f.head.style !== "morph" ? l(
        g,
        /** @type {HTMLHeadElement} */
        y,
        f
      ) : (b(g, y, f), E(g, f) || a(f, g, y))), f.callbacks.afterNodeMorphed(g, y)), g);
    }
    function b(g, y, f) {
      let p = y.nodeType;
      if (p === 1) {
        const _ = (
          /** @type {Element} */
          g
        ), w = (
          /** @type {Element} */
          y
        ), D = _.attributes, A = w.attributes;
        for (const C of A)
          m(C.name, _, "update", f) || _.getAttribute(C.name) !== C.value && _.setAttribute(C.name, C.value);
        for (let C = D.length - 1; 0 <= C; C--) {
          const S = D[C];
          if (S && !w.hasAttribute(S.name)) {
            if (m(S.name, _, "remove", f))
              continue;
            _.removeAttribute(S.name);
          }
        }
        E(_, f) || v(_, w, f);
      }
      (p === 8 || p === 3) && g.nodeValue !== y.nodeValue && (g.nodeValue = y.nodeValue);
    }
    function v(g, y, f) {
      if (g instanceof HTMLInputElement && y instanceof HTMLInputElement && y.type !== "file") {
        let p = y.value, _ = g.value;
        x(g, y, "checked", f), x(g, y, "disabled", f), y.hasAttribute("value") ? _ !== p && (m("value", g, "update", f) || (g.setAttribute("value", p), g.value = p)) : m("value", g, "remove", f) || (g.value = "", g.removeAttribute("value"));
      } else if (g instanceof HTMLOptionElement && y instanceof HTMLOptionElement)
        x(g, y, "selected", f);
      else if (g instanceof HTMLTextAreaElement && y instanceof HTMLTextAreaElement) {
        let p = y.value, _ = g.value;
        if (m("value", g, "update", f))
          return;
        p !== _ && (g.value = p), g.firstChild && g.firstChild.nodeValue !== p && (g.firstChild.nodeValue = p);
      }
    }
    function x(g, y, f, p) {
      const _ = y[f], w = g[f];
      if (_ !== w) {
        const D = m(
          f,
          g,
          "update",
          p
        );
        D || (g[f] = y[f]), _ ? D || g.setAttribute(f, "") : m(f, g, "remove", p) || g.removeAttribute(f);
      }
    }
    function m(g, y, f, p) {
      return g === "value" && p.ignoreActiveValue && y === document.activeElement ? !0 : p.callbacks.beforeAttributeUpdated(g, y, f) === !1;
    }
    function E(g, y) {
      return !!y.ignoreActiveValue && g === document.activeElement && g !== document.body;
    }
    return h;
  })();
  function o(h, b, v, x) {
    if (h.head.block) {
      const m = b.querySelector("head"), E = v.querySelector("head");
      if (m && E) {
        const g = l(m, E, h);
        return Promise.all(g).then(() => {
          const y = Object.assign(h, {
            head: {
              block: !1,
              ignore: !0
            }
          });
          return x(y);
        });
      }
    }
    return x(h);
  }
  function l(h, b, v) {
    let x = [], m = [], E = [], g = [], y = /* @__PURE__ */ new Map();
    for (const p of b.children)
      y.set(p.outerHTML, p);
    for (const p of h.children) {
      let _ = y.has(p.outerHTML), w = v.head.shouldReAppend(p), D = v.head.shouldPreserve(p);
      _ || D ? w ? m.push(p) : (y.delete(p.outerHTML), E.push(p)) : v.head.style === "append" ? w && (m.push(p), g.push(p)) : v.head.shouldRemove(p) !== !1 && m.push(p);
    }
    g.push(...y.values());
    let f = [];
    for (const p of g) {
      let _ = (
        /** @type {ChildNode} */
        document.createRange().createContextualFragment(p.outerHTML).firstChild
      );
      if (v.callbacks.beforeNodeAdded(_) !== !1) {
        if ("href" in _ && _.href || "src" in _ && _.src) {
          let w, D = new Promise(function(A) {
            w = A;
          });
          _.addEventListener("load", function() {
            w();
          }), f.push(D);
        }
        h.appendChild(_), v.callbacks.afterNodeAdded(_), x.push(_);
      }
    }
    for (const p of m)
      v.callbacks.beforeNodeRemoved(p) !== !1 && (h.removeChild(p), v.callbacks.afterNodeRemoved(p));
    return v.head.afterHeadMorphed(h, {
      added: x,
      kept: E,
      removed: m
    }), f;
  }
  const c = /* @__PURE__ */ (function() {
    function h(f, p, _) {
      const { persistentIds: w, idMap: D } = g(f, p), A = b(_), C = A.morphStyle || "outerHTML";
      if (!["innerHTML", "outerHTML"].includes(C))
        throw `Do not understand how to morph style ${C}`;
      return {
        target: f,
        newContent: p,
        config: A,
        morphStyle: C,
        ignoreActive: A.ignoreActive,
        ignoreActiveValue: A.ignoreActiveValue,
        restoreFocus: A.restoreFocus,
        idMap: D,
        persistentIds: w,
        pantry: v(),
        activeElementAndParents: x(f),
        callbacks: A.callbacks,
        head: A.head
      };
    }
    function b(f) {
      let p = Object.assign({}, t);
      return Object.assign(p, f), p.callbacks = Object.assign(
        {},
        t.callbacks,
        f.callbacks
      ), p.head = Object.assign({}, t.head, f.head), p;
    }
    function v() {
      const f = document.createElement("div");
      return f.hidden = !0, document.body.insertAdjacentElement("afterend", f), f;
    }
    function x(f) {
      let p = [], _ = document.activeElement;
      if (_?.tagName !== "BODY" && f.contains(_))
        for (; _ && (p.push(_), _ !== f); )
          _ = _.parentElement;
      return p;
    }
    function m(f) {
      let p = Array.from(f.querySelectorAll("[id]"));
      return f.getAttribute?.("id") && p.push(f), p;
    }
    function E(f, p, _, w) {
      for (const D of w) {
        const A = (
          /** @type {String} */
          D.getAttribute("id")
        );
        if (p.has(A)) {
          let C = D;
          for (; C; ) {
            let S = f.get(C);
            if (S == null && (S = /* @__PURE__ */ new Set(), f.set(C, S)), S.add(A), C === _) break;
            C = C.parentElement;
          }
        }
      }
    }
    function g(f, p) {
      const _ = m(f), w = m(p), D = y(_, w);
      let A = /* @__PURE__ */ new Map();
      E(A, D, f, _);
      const C = p.__idiomorphRoot || p;
      return E(A, D, C, w), { persistentIds: D, idMap: A };
    }
    function y(f, p) {
      let _ = /* @__PURE__ */ new Set(), w = /* @__PURE__ */ new Map();
      for (const { id: A, tagName: C } of f)
        w.has(A) ? _.add(A) : w.set(A, C);
      let D = /* @__PURE__ */ new Set();
      for (const { id: A, tagName: C } of p)
        D.has(A) ? _.add(A) : w.get(A) === C && D.add(A);
      for (const A of _)
        D.delete(A);
      return D;
    }
    return h;
  })(), { normalizeElement: u, normalizeParent: d } = /* @__PURE__ */ (function() {
    const h = /* @__PURE__ */ new WeakSet();
    function b(E) {
      return E instanceof Document ? E.documentElement : E;
    }
    function v(E) {
      if (E == null)
        return document.createElement("div");
      if (typeof E == "string")
        return v(m(E));
      if (h.has(
        /** @type {Element} */
        E
      ))
        return (
          /** @type {Element} */
          E
        );
      if (E instanceof Node) {
        if (E.parentNode)
          return (
            /** @type {any} */
            new x(E)
          );
        {
          const g = document.createElement("div");
          return g.append(E), g;
        }
      } else {
        const g = document.createElement("div");
        for (const y of [...E])
          g.append(y);
        return g;
      }
    }
    class x {
      /** @param {Node} node */
      constructor(g) {
        this.originalNode = g, this.realParentNode = /** @type {Element} */
        g.parentNode, this.previousSibling = g.previousSibling, this.nextSibling = g.nextSibling;
      }
      /** @returns {Node[]} */
      get childNodes() {
        const g = [];
        let y = this.previousSibling ? this.previousSibling.nextSibling : this.realParentNode.firstChild;
        for (; y && y != this.nextSibling; )
          g.push(y), y = y.nextSibling;
        return g;
      }
      /**
       * @param {string} selector
       * @returns {Element[]}
       */
      querySelectorAll(g) {
        return this.childNodes.reduce(
          (y, f) => {
            if (f instanceof Element) {
              f.matches(g) && y.push(f);
              const p = f.querySelectorAll(g);
              for (let _ = 0; _ < p.length; _++)
                y.push(p[_]);
            }
            return y;
          },
          /** @type {Element[]} */
          []
        );
      }
      /**
       * @param {Node} node
       * @param {Node} referenceNode
       * @returns {Node}
       */
      insertBefore(g, y) {
        return this.realParentNode.insertBefore(g, y);
      }
      /**
       * @param {Node} node
       * @param {Node} referenceNode
       * @returns {Node}
       */
      moveBefore(g, y) {
        return this.realParentNode.moveBefore(g, y);
      }
      /**
       * for later use with populateIdMapWithTree to halt upwards iteration
       * @returns {Node}
       */
      get __idiomorphRoot() {
        return this.originalNode;
      }
    }
    function m(E) {
      let g = new DOMParser(), y = E.replace(
        /<svg(\s[^>]*>|>)([\s\S]*?)<\/svg>/gim,
        ""
      );
      if (y.match(/<\/html>/) || y.match(/<\/head>/) || y.match(/<\/body>/)) {
        let f = g.parseFromString(E, "text/html");
        if (y.match(/<\/html>/))
          return h.add(f), f;
        {
          let p = f.firstChild;
          return p && h.add(p), p;
        }
      } else {
        let p = (
          /** @type {HTMLTemplateElement} */
          g.parseFromString(
            "<body><template>" + E + "</template></body>",
            "text/html"
          ).body.querySelector("template").content
        );
        return h.add(p), p;
      }
    }
    return { normalizeElement: b, normalizeParent: v };
  })();
  return {
    morph: n,
    defaults: t
  };
})();
(function() {
  function e(t) {
    if (t === "morph" || t === "morph:outerHTML")
      return { morphStyle: "outerHTML" };
    if (t === "morph:innerHTML")
      return { morphStyle: "innerHTML" };
    if (t.startsWith("morph:"))
      return Function("return (" + t.slice(6) + ")")();
  }
  htmx.defineExtension("morph", {
    isInlineSwap: function(t) {
      let n = e(t);
      return n?.morphStyle === "outerHTML" || n?.morphStyle == null;
    },
    handleSwap: function(t, n, i) {
      let r = e(t);
      if (r)
        return Idiomorph.morph(n, i.children, r);
    }
  });
})();
const ServerEventName = {
  JOB_STATUS_CHANGE: "job-status-change",
  JOB_PROGRESS: "job-progress",
  LIBRARY_CHANGE: "library-change",
  JOB_LIST_CHANGE: "job-list-change"
};
class EventClient {
  callbacks = /* @__PURE__ */ new Set();
  eventSource;
  reconnectTimeout;
  isConnected = !1;
  /**
   * Start the SSE connection.
   */
  connect() {
    if (this.eventSource) {
      console.warn("EventClient already connected");
      return;
    }
    console.log("📡 Connecting to SSE endpoint..."), this.eventSource = new EventSource("/web/events"), this.eventSource.addEventListener("open", () => {
      console.log("📡 SSE connection established"), this.isConnected = !0;
    }), this.eventSource.addEventListener("error", (n) => {
      console.error("❌ SSE connection error:", n), this.isConnected = !1;
    });
    const t = Object.values(ServerEventName);
    console.log("🔧 Setting up event listeners", t);
    for (const n of t)
      this.eventSource.addEventListener(n, (i) => {
        try {
          const r = JSON.parse(i.data);
          this.notifyCallbacks({
            type: n,
            payload: r
          });
        } catch (r) {
          console.error(`Failed to parse SSE event data: ${r}`);
        }
      });
    this.eventSource.addEventListener("message", (n) => {
      console.log("📨 Generic message event received:", n.data);
    });
  }
  /**
   * Subscribe to events with a callback.
   * @param callback Function to call when events are received
   * @returns Unsubscribe function
   */
  subscribe(t) {
    return this.callbacks.add(t), () => {
      this.callbacks.delete(t);
    };
  }
  /**
   * Disconnect and clean up resources.
   */
  disconnect() {
    this.reconnectTimeout && (clearTimeout(this.reconnectTimeout), this.reconnectTimeout = void 0), this.eventSource && (this.eventSource.close(), this.eventSource = void 0), this.isConnected = !1;
  }
  /**
   * Notify all callbacks of an event.
   */
  notifyCallbacks(t) {
    for (const n of this.callbacks)
      try {
        n(t);
      } catch (i) {
        console.error("Error in event callback:", i);
      }
  }
  /**
   * Check if the client is currently connected.
   */
  isActive() {
    return this.isConnected;
  }
}
const VERSION_PREFIX_PATTERN = /^v/i, normalizeVersionTag = (e) => {
  if (typeof e != "string")
    return null;
  const t = e.trim();
  if (t.length === 0)
    return null;
  const n = t.replace(VERSION_PREFIX_PATTERN, "");
  return n.length > 0 ? n : null;
}, extractComparableSegments = (e) => {
  const n = e.split(/[+-]/)[0].split(".");
  if (n.length === 0)
    return null;
  const i = [];
  for (const r of n) {
    if (r.length === 0)
      return null;
    const a = Number.parseInt(r, 10);
    if (Number.isNaN(a))
      return null;
    i.push(a);
  }
  return i;
}, isVersionNewer = (e, t) => {
  const n = normalizeVersionTag(e), i = normalizeVersionTag(t);
  if (!n || !i)
    return !1;
  const r = extractComparableSegments(n), a = extractComparableSegments(i);
  if (!r || !a)
    return !1;
  const s = Math.max(r.length, a.length);
  for (let o = 0; o < s; o += 1) {
    const l = r[o] ?? 0, c = a[o] ?? 0;
    if (l > c)
      return !0;
    if (l < c)
      return !1;
  }
  return !1;
}, getComparableVersion = (e) => {
  const t = normalizeVersionTag(e);
  if (!t)
    return null;
  const n = t.split(/[+-]/)[0];
  return n.length > 0 ? n : null;
}, fallbackReleaseLabel = (e) => {
  const t = getComparableVersion(e);
  return t ? `v${t}` : null;
};
module_default.plugin(module_default$1);
window.Alpine = module_default;
const LATEST_RELEASE_ENDPOINT = "https://api.github.com/repos/arabold/docs-mcp-server/releases/latest", LATEST_RELEASE_FALLBACK_URL = "https://github.com/arabold/docs-mcp-server/releases/latest";
document.addEventListener("alpine:init", () => {
  module_default.data("versionUpdate", (e) => ({
    currentVersion: typeof e?.currentVersion == "string" ? e.currentVersion : null,
    hasUpdate: !1,
    latestVersionLabel: "",
    latestReleaseUrl: LATEST_RELEASE_FALLBACK_URL,
    hasChecked: !1,
    queueCheck() {
      window.setTimeout(() => {
        this.checkForUpdate();
      }, 0);
    },
    async checkForUpdate() {
      if (!this.hasChecked && (this.hasChecked = !0, !!this.currentVersion))
        try {
          const t = await fetch(LATEST_RELEASE_ENDPOINT, {
            headers: {
              Accept: "application/vnd.github+json",
              "User-Agent": "docs-mcp-server-ui"
            }
          });
          if (!t.ok) {
            console.debug("Release check request failed", t.status);
            return;
          }
          const n = await t.json(), i = n.tag_name;
          if (!isVersionNewer(i, this.currentVersion))
            return;
          const r = (typeof i == "string" && i.trim().length > 0 ? i.trim() : null) ?? fallbackReleaseLabel(i);
          if (!r)
            return;
          this.latestVersionLabel = r, this.latestReleaseUrl = typeof n.html_url == "string" && n.html_url.trim().length ? n.html_url : LATEST_RELEASE_FALLBACK_URL, this.hasUpdate = !0;
        } catch (t) {
          console.debug("Release check request threw", t);
        }
    }
  }));
});
module_default.store("toast", {
  visible: !1,
  message: "",
  type: "info",
  timeoutId: null,
  show(e, t = "info", n = 5e3) {
    const i = module_default.store("toast");
    i.timeoutId !== null && (clearTimeout(i.timeoutId), i.timeoutId = null), i.message = e, i.type = t, i.visible = !0, i.timeoutId = window.setTimeout(() => {
      i.hide();
    }, n);
  },
  hide() {
    const e = module_default.store("toast");
    e.visible = !1, e.timeoutId !== null && (clearTimeout(e.timeoutId), e.timeoutId = null);
  }
});
module_default.start();
initFlowbite();
const eventClient = new EventClient();
eventClient.subscribe((e) => {
  console.log(`📋 Received event: ${e.type}`, e.payload), document.body.dispatchEvent(
    new CustomEvent(e.type, {
      detail: e.payload
    })
  );
});
eventClient.connect();
window.addEventListener("beforeunload", () => {
  eventClient.disconnect();
});
const confirmationTimeouts = /* @__PURE__ */ new Map();
function startConfirmationTimeout(e, t = 3e3) {
  clearConfirmationTimeout(e);
  const n = Date.now() + t, i = window.setTimeout(() => {
    confirmationTimeouts.delete(e);
    const r = document.getElementById(e);
    if (r) {
      const a = module_default.$data(r);
      a && (a.confirming = !1);
    }
  }, t);
  confirmationTimeouts.set(e, { timeoutId: i, expiresAt: n });
}
function clearConfirmationTimeout(e) {
  const t = confirmationTimeouts.get(e);
  t && (clearTimeout(t.timeoutId), confirmationTimeouts.delete(e));
}
function hasActiveConfirmation(e) {
  const t = confirmationTimeouts.get(e);
  return t !== void 0 && t.expiresAt > Date.now();
}
const confirmationManager = {
  start: startConfirmationTimeout,
  clear: clearConfirmationTimeout,
  isActive: hasActiveConfirmation
};
window.confirmationManager = confirmationManager;
document.body.addEventListener("htmx:beforeSwap", (e) => {
  const n = e.detail?.target;
  n && module_default.destroyTree(n);
});
document.body.addEventListener("htmx:afterSwap", (e) => {
  const n = e.detail?.target;
  n && (n.querySelectorAll("[x-data][id]").forEach((i) => {
    i.id && hasActiveConfirmation(i.id) && (i.dataset.confirming = "true");
  }), module_default.initTree(n));
});
document.body.addEventListener("htmx:responseError", (e) => {
  const n = e.detail?.xhr;
  if (!n) return;
  let i = "An error occurred";
  try {
    if (n.getResponseHeader("content-type")?.includes("application/json")) {
      const s = JSON.parse(n.response);
      i = s.message || s.error || i;
    } else n.response && typeof n.response == "string" && (i = n.response);
  } catch {
    i = n.statusText || i;
  }
  module_default.store("toast").show(i, "error"), e.preventDefault();
});
document.body.addEventListener("htmx:afterRequest", (e) => {
  const n = e.detail?.xhr;
  if (!n || !n.getResponseHeader) return;
  const i = n.getResponseHeader("HX-Trigger");
  if (i)
    try {
      const r = JSON.parse(i);
      r.toast && module_default.store("toast").show(r.toast.message, r.toast.type || "info");
    } catch (r) {
      console.debug("Failed to parse HX-Trigger header", r);
    }
});
//# sourceMappingURL=main.js.map
