export function browserElementsAtPointExpression(x: number, y: number): string {
  const pointX = Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0
  const pointY = Number.isFinite(y) ? Math.max(0, Math.round(y)) : 0

  return `(() => {
    const escapeCss = (value) => globalThis.CSS && globalThis.CSS.escape
      ? globalThis.CSS.escape(String(value))
      : String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => '\\\\' + char);
    const unique = (selector) => {
      try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
    };
    const stableClass = (name) => {
      if (!name || name.startsWith('_') || name.startsWith('css-')) return false;
      if (/^[a-z]{1,3}[A-Za-z0-9_]{8,}$/.test(name)) return false;
      return name.length < 80;
    };
    const selectorFor = (element) => {
      if (element.id) {
        const idSelector = '#' + escapeCss(element.id);
        if (unique(idSelector)) return idSelector;
      }
      const testId = element.getAttribute('data-testid');
      if (testId) {
        const testSelector = '[data-testid="' + String(testId).replace(/"/g, '\\\\"') + '"]';
        if (unique(testSelector)) return testSelector;
      }

      const classes = Array.from(element.classList || []).filter(stableClass).slice(0, 4);
      for (const className of classes) {
        const candidate = element.tagName.toLowerCase() + '.' + escapeCss(className);
        if (unique(candidate)) return candidate;
      }
      if (classes.length > 1) {
        const candidate = element.tagName.toLowerCase() + classes.map((name) => '.' + escapeCss(name)).join('');
        if (unique(candidate)) return candidate;
      }

      const parts = [];
      let current = element;
      while (current instanceof Element && current !== document.documentElement && parts.length < 6) {
        let part = current.tagName.toLowerCase();
        const currentClasses = Array.from(current.classList || []).filter(stableClass);
        if (currentClasses.length > 0) part += '.' + escapeCss(currentClasses[0]);
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
        }
        parts.unshift(part);
        const candidate = parts.join(' > ');
        if (unique(candidate)) return candidate;
        current = parent;
      }
      return parts.join(' > ');
    };
    const reactContextFor = (element) => {
      let current = element;
      while (current) {
        const fiberKey = Object.keys(current).find((key) => key.startsWith('__reactFiber$'));
        let fiber = fiberKey ? current[fiberKey] : null;
        if (fiber) {
          const components = [];
          let sourceFile = null;
          while (fiber) {
            const type = fiber.type;
            const name = typeof type === 'function'
              ? (type.displayName || type.name)
              : (typeof type === 'object' && type ? type.displayName : null);
            if (name && name.length > 2 && !name.startsWith('_') && !/^(Fragment|Suspense|StrictMode|Provider|Consumer|Context)$/.test(name)) {
              if (components[components.length - 1] !== name) components.push(name);
            }
            const source = fiber._debugSource;
            if (!sourceFile && source && source.fileName) {
              sourceFile = { fileName: source.fileName, lineNumber: source.lineNumber || null, columnNumber: source.columnNumber || null };
            }
            fiber = fiber.return;
          }
          return { components, sourceFile };
        }
        current = current.parentElement;
      }
      return { components: [], sourceFile: null };
    };
    const describe = (element) => {
      const rect = element.getBoundingClientRect();
      const text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240);
      const label = element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title') || null;
      const react = reactContextFor(element);
      const parent = element.parentElement;
      const children = Array.from(element.children || []).slice(0, 6).map((child) => child.tagName.toLowerCase());
      return {
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        label,
        text: text || null,
        selector: selectorFor(element),
        classes: Array.from(element.classList || []).slice(0, 16),
        componentName: react.components[0] || null,
        componentPath: react.components,
        sourceFile: react.sourceFile,
        parentContext: parent ? parent.tagName.toLowerCase() + (parent.id ? '#' + parent.id : '') : null,
        childSummary: children.length ? children.length + ' children: ' + children.join(', ') : null,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    };

    const seen = new Set();
    return document.elementsFromPoint(${pointX}, ${pointY})
      .filter((element) => {
        if (!(element instanceof Element) || seen.has(element)) return false;
        seen.add(element);
        return element !== document.documentElement && element.tagName !== 'SCRIPT' && element.tagName !== 'STYLE';
      })
      .slice(0, 10)
      .map(describe);
  })()`
}
