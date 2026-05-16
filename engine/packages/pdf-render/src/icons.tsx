import React from 'react';
import { Svg, Path } from './pdf-elements.js';

// SVG path data extracted from @tabler/icons (outline, viewBox="0 0 24 24")
const ICON_PATHS: Record<IconName, string[]> = {
  'mail': [
    'M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10',
    'M3 7l9 6l9 -6',
  ],
  'package': [
    'M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5',
    'M12 12l8 -4.5',
    'M12 12l0 9',
    'M12 12l-8 -4.5',
    'M16 5.25l-8 4.5',
  ],
  'world': [
    'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0',
    'M3.6 9h16.8',
    'M3.6 15h16.8',
    'M11.5 3a17 17 0 0 0 0 18',
    'M12.5 3a17 17 0 0 1 0 18',
  ],
  'file-text': [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2',
    'M9 9l1 0',
    'M9 13l6 0',
    'M9 17l6 0',
  ],
  'info-circle': [
    'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0',
    'M12 9h.01',
    'M11 12h1v4h1',
  ],
  'bulb': [
    'M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7',
    'M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3',
    'M9.7 17l4.6 0',
  ],
  'message-circle': [
    'M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1',
  ],
  'eye-off': [
    'M10.585 10.587a2 2 0 0 0 2.829 2.828',
    'M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87',
    'M3 3l18 18',
  ],
  'alert-circle': [
    'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0',
    'M12 8v4',
    'M12 16h.01',
  ],
  'coin': [
    'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0',
    'M14.8 9a2 2 0 0 0 -1.8 -1h-2a2 2 0 1 0 0 4h2a2 2 0 1 1 0 4h-2a2 2 0 0 1 -1.8 -1',
    'M12 7v10',
  ],
  'users': [
    'M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
    'M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2',
    'M16 3.13a4 4 0 0 1 0 7.75',
    'M21 21v-2a4 4 0 0 0 -3 -3.85',
  ],
  'clock': [
    'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0',
    'M12 7v5l3 3',
  ],
  'arrows-maximize': [
    'M16 4l4 0l0 4',
    'M14 10l6 -6',
    'M8 20l-4 0l0 -4',
    'M4 20l6 -6',
    'M16 20l4 0l0 -4',
    'M14 14l6 6',
    'M8 4l-4 0l0 4',
    'M4 4l6 6',
  ],
  'search': [
    'M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0',
    'M21 21l-6 -6',
  ],
  'layout-dashboard': [
    'M5 4h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1',
    'M5 16h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1',
    'M15 12h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1',
    'M15 4h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1',
  ],
  'user': [
    'M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0',
    'M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2',
  ],
  'tools': [
    'M3 21h4l13 -13a1.5 1.5 0 0 0 -4 -4l-13 13v4',
    'M14.5 5.5l4 4',
    'M12 8l-5 -5l-4 4l5 5',
    'M7 8l-1.5 1.5',
    'M16 12l5 5l-4 4l-5 -5',
    'M16 17l-1.5 1.5',
  ],
  'arrow-right': [
    'M5 12l14 0',
    'M13 18l6 -6',
    'M13 6l6 6',
  ],
  'message': [
    'M8 9h8',
    'M8 13h6',
    'M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12',
  ],
  'alert-triangle': [
    'M12 9v4',
    'M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0',
    'M12 16h.01',
  ],
};

export type IconName =
  | 'mail' | 'package' | 'world' | 'file-text' | 'info-circle'
  | 'bulb' | 'message-circle' | 'eye-off' | 'alert-circle' | 'coin'
  | 'users' | 'clock' | 'arrows-maximize' | 'search' | 'layout-dashboard'
  | 'user' | 'tools' | 'arrow-right' | 'message' | 'alert-triangle';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 12, color = '#1E2A4A' }: IconProps) {
  const paths = ICON_PATHS[name];
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size}>
      {paths.map((d, i) => (
        <Path
          key={i}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
