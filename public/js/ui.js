export function setConnectionStatus(element, state, message) {
  element.dataset.state = state;
  element.textContent = message;
}

export function focusHeading(element) {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'nearest' });
}

export function renderMetrics(target, entries) {
  target.replaceChildren(
    ...entries.map(([label, value]) => {
      const metric = document.createElement('div');
      metric.className = 'metric';
      const number = document.createElement('strong');
      number.className = 'metric-value';
      number.textContent = value;
      const caption = document.createElement('span');
      caption.className = 'metric-label';
      caption.textContent = label;
      metric.append(number, caption);
      return metric;
    }),
  );
}
