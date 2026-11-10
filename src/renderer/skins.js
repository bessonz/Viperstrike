// To add a skin: add an entry here and a matching `[data-skin="<id>"]` token block in tokens.css.
export const DEFAULT_SKIN = 'viperstrike';

export const SKINS = [
  { id: 'viperstrike', name: 'Viperstrike', description: 'Slate and steel, the default', swatches: ['#1c1d22', '#313b44', '#606467', '#aaa8ad'] },
  { id: 'blaze', name: 'Blaze', description: 'Black with a red-orange glow', swatches: ['#141415', '#df040a', '#ff6b27', '#ffffff'] },
  { id: 'forest', name: 'Forest', description: 'Deep greens', swatches: ['#0f2a1c', '#17573a', '#4a7d62', '#8fc7a8'] },
  { id: 'midnight', name: 'Midnight', description: 'Indigo and periwinkle', swatches: ['#14152e', '#2c3069', '#5b6099', '#a7abde'] },
  { id: 'ember', name: 'Ember', description: 'Warm rust and clay', swatches: ['#241512', '#5c2b1c', '#8c5a48', '#dba88f'] },
  { id: 'arctic', name: 'Arctic', description: 'Cold steel blues', swatches: ['#0f2230', '#1f4e6c', '#477593', '#9fcce4'] },
];
