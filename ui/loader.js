/**
 * Loader Component Helper
 * Creates animated loading bars
 */

/**
 * Creates a loader element
 * @param {Object} options - Configuration options
 * @param {string} options.size - Size variant: 'sm', 'md' (default), or 'lg'
 * @param {string} options.color - Color variant: 'white' (default), 'primary', or 'muted'
 * @param {string} options.className - Additional CSS classes
 * @returns {HTMLElement} The loader element
 */
function createLoader(options = {}) {
  const {
    size = 'md',
    color = 'white',
    className = ''
  } = options;

  const loader = document.createElement('div');
  loader.className = 'loader';
  
  // Add size class
  if (size === 'sm') loader.classList.add('loader-sm');
  if (size === 'lg') loader.classList.add('loader-lg');
  
  // Add color class
  if (color === 'primary') loader.classList.add('loader-primary');
  if (color === 'muted') loader.classList.add('loader-muted');
  
  // Add custom classes
  if (className) loader.classList.add(...className.split(' '));
  
  // Create 3 bars
  for (let i = 0; i < 3; i++) {
    const bar = document.createElement('div');
    bar.className = 'loader-bar';
    loader.appendChild(bar);
  }
  
  return loader;
}

/**
 * Shows a loader in a container element
 * @param {HTMLElement|string} container - Container element or selector
 * @param {Object} options - Loader options (see createLoader)
 * @returns {HTMLElement} The loader element
 */
function showLoader(container, options = {}) {
  const element = typeof container === 'string' 
    ? document.querySelector(container) 
    : container;
    
  if (!element) {
    console.error('Loader container not found');
    return null;
  }
  
  const loader = createLoader(options);
  element.appendChild(loader);
  return loader;
}

/**
 * Removes all loaders from a container
 * @param {HTMLElement|string} container - Container element or selector
 */
function hideLoader(container) {
  const element = typeof container === 'string' 
    ? document.querySelector(container) 
    : container;
    
  if (!element) return;
  
  const loaders = element.querySelectorAll('.loader');
  loaders.forEach(loader => loader.remove());
}

/**
 * Creates a loader HTML string (useful for innerHTML)
 * @param {Object} options - Configuration options
 * @param {string} options.size - Size variant: 'sm', 'md' (default), or 'lg'
 * @param {string} options.color - Color variant: 'white' (default), 'primary', or 'muted'
 * @param {string} options.className - Additional CSS classes
 * @returns {string} The loader HTML string
 */
function loaderHTML(options = {}) {
  const {
    size = 'md',
    color = 'white',
    className = ''
  } = options;

  const classes = ['loader'];
  if (size === 'sm') classes.push('loader-sm');
  if (size === 'lg') classes.push('loader-lg');
  if (color === 'primary') classes.push('loader-primary');
  if (color === 'muted') classes.push('loader-muted');
  if (className) classes.push(className);

  const bars = Array(3).fill('<div class="loader-bar"></div>').join('');
  return `<div class="${classes.join(' ')}">${bars}</div>`;
}

// Export if using modules, otherwise attach to window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createLoader, showLoader, hideLoader, loaderHTML };
} else {
  window.createLoader = createLoader;
  window.showLoader = showLoader;
  window.hideLoader = hideLoader;
  window.loaderHTML = loaderHTML;
}

/*
# Loader Component

A reusable loading animation component with animated vertical bars that wave in sequence.

## Usage

### Basic Loader (Default)
```html
<div class="loader">
  <div class="loader-bar"></div>
  <div class="loader-bar"></div>
  <div class="loader-bar"></div>
</div>
```

### Size Variants

#### Small Loader
```html
<div class="loader loader-sm">
  <div class="loader-bar"></div>
  <div class="loader-bar"></div>
  <div class="loader-bar"></div>
</div>
```

#### Large Loader
```html
<div class="loader loader-lg">
  <div class="loader-bar"></div>
  <div class="loader-bar"></div>
  <div class="loader-bar"></div>
</div>
```

### Color Variants

#### Primary Color (Orange)
```html
<div class="loader loader-primary">
  <div class="loader-bar"></div>
  <div class="loader-bar"></div>
  <div class="loader-bar"></div>
</div>
```

#### Muted Color (Gray)
```html
<div class="loader loader-muted">
  <div class="loader-bar"></div>
  <div class="loader-bar"></div>
  <div class="loader-bar"></div>
</div>
```

### Combining Variants

You can combine size and color variants:

```html
<div class="loader loader-sm loader-primary">
  <div class="loader-bar"></div>
  <div class="loader-bar"></div>
  <div class="loader-bar"></div>
</div>
```

## Specifications

- **Default Size**: 32x32px
- **Small Size**: 24x24px  
- **Large Size**: 48x48px
- **Animation**: 1.2s infinite wave animation
- **Colors**: White (default), Orange (#ff7700), Gray (#a1a1aa)

## Animation Details

The loader automatically animates with a wave effect where each bar:
- Scales vertically by 1.5x at its peak
- Fades between 70% and 100% opacity
- Animates with staggered delays to create a smooth wave pattern

No JavaScript required - it's pure CSS animation!

## JavaScript Helpers

For convenience, you can use the JavaScript helper functions to create loaders dynamically.

### Include the Script

Add to your HTML:
```html
<script src="ui/loader.js"></script>
```

### Create a Loader Element

```javascript
// Create a default loader
const loader = createLoader();

// Create a small primary loader
const smallLoader = createLoader({ 
  size: 'sm', 
  color: 'primary' 
});

// Create a large muted loader with custom class
const customLoader = createLoader({ 
  size: 'lg', 
  color: 'muted',
  className: 'my-custom-class'
});
```

### Show/Hide Loader in Container

```javascript
// Show loader in an element
const loader = showLoader('#my-container', { size: 'sm', color: 'primary' });

// Hide all loaders in container
hideLoader('#my-container');
```

### Get Loader as HTML String

```javascript
// Useful for innerHTML
const html = loaderHTML({ size: 'sm', color: 'primary' });
document.getElementById('container').innerHTML = html;
```

### Example: Loading State

```javascript
// Show loader while fetching data
const container = document.querySelector('.content');
showLoader(container, { color: 'primary' });

fetch('/api/data')
  .then(response => response.json())
  .then(data => {
    hideLoader(container);
    // Display data
  });
```
*/