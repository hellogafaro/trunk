export function browserElementsAtPointExpression(x: number, y: number): string {
  const pointX = Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0;
  const pointY = Number.isFinite(y) ? Math.max(0, Math.round(y)) : 0;

  return `(() => {
    const escapeCss = (value) => globalThis.CSS && globalThis.CSS.escape
      ? globalThis.CSS.escape(String(value))
      : String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => '\\\\' + character);
    const unique = (selector) => {
      try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
    };
    const stableClass = (name) => Boolean(name)
      && !name.startsWith('_')
      && !name.startsWith('css-')
      && !/^[a-z]{1,3}[A-Za-z0-9_]{8,}$/.test(name)
      && name.length < 80;
    const selectorFor = (element) => {
      if (element.id) {
        const candidate = '#' + escapeCss(element.id);
        if (unique(candidate)) return candidate;
      }
      const testId = element.getAttribute('data-testid');
      if (testId) {
        const candidate = '[data-testid="' + String(testId).replace(/"/g, '\\\\"') + '"]';
        if (unique(candidate)) return candidate;
      }
      const classes = Array.from(element.classList || []).filter(stableClass).slice(0, 4);
      for (const className of classes) {
        const candidate = element.tagName.toLowerCase() + '.' + escapeCss(className);
        if (unique(candidate)) return candidate;
      }
      const parts = [];
      let current = element;
      while (current instanceof Element && current !== document.documentElement && parts.length < 6) {
        let part = current.tagName.toLowerCase();
        const currentClass = Array.from(current.classList || []).find(stableClass);
        if (currentClass) part += '.' + escapeCss(currentClass);
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
      return parts.join(' > ') || null;
    };
    const reactContextFor = (element) => {
      let current = element;
      while (current) {
        const fiberKey = Object.keys(current).find((key) => key.startsWith('__reactFiber$'));
        let fiber = fiberKey ? current[fiberKey] : null;
        if (fiber) {
          const names = [];
          const stack = [];
          while (fiber) {
            const type = fiber.type;
            const name = typeof type === 'function'
              ? (type.displayName || type.name || null)
              : (typeof type === 'object' && type ? type.displayName || null : null);
            if (name && name.length > 2 && !name.startsWith('_')
              && !/^(Fragment|Suspense|StrictMode|Provider|Consumer|Context)$/.test(name)
              && names[names.length - 1] !== name) names.push(name);
            const source = fiber._debugSource;
            if (source && source.fileName) {
              stack.push({
                functionName: name,
                fileName: source.fileName,
                lineNumber: source.lineNumber || null,
                columnNumber: source.columnNumber || null,
              });
            }
            fiber = fiber.return;
          }
          return { componentName: names[0] || null, stack };
        }
        current = current.parentElement;
      }
      return { componentName: null, stack: [] };
    };
    const computedStyleText = (element) => {
      const computed = getComputedStyle(element);
      return [
        'display', 'position', 'width', 'height', 'color', 'background-color',
        'font-family', 'font-size', 'font-weight', 'line-height', 'padding',
        'margin', 'gap', 'border', 'border-radius', 'opacity',
      ].map((property) => property + ': ' + computed.getPropertyValue(property) + ';').join('\\n');
    };
    const pickedAt = new Date().toISOString();
    const seen = new Set();
    return document.elementsFromPoint(${pointX}, ${pointY})
      .filter((element) => {
        if (!(element instanceof Element) || seen.has(element)) return false;
        seen.add(element);
        return element !== document.documentElement
          && element.tagName !== 'SCRIPT'
          && element.tagName !== 'STYLE';
      })
      .slice(0, 10)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const react = reactContextFor(element);
        return {
          element: {
            pageUrl: location.href,
            pageTitle: document.title.trim() || null,
            tagName: element.tagName.toLowerCase(),
            selector: selectorFor(element),
            htmlPreview: element.outerHTML.slice(0, 2000),
            componentName: react.componentName,
            source: react.stack[0] || null,
            stack: react.stack,
            styles: computedStyleText(element),
            pickedAt,
          },
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      });
  })()`;
}
