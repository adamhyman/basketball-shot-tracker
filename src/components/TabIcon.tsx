import Svg, { Rect, Circle, Line, Path } from 'react-native-svg';

export type Tab = 'shots' | 'stats' | 'heat' | 'practice' | 'practiceCharts' | 'nbaLive' | 'settings';

const HEAT_ICON_OPACITY = [0.4, 0.6, 1, 0.4, 1, 0.8, 0.6, 0.8, 0.4];

export function TabIcon({ tab, color }: { tab: Tab; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, fill: 'none' };
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24">
      {tab === 'shots' && (
        <>
          <Circle cx={12} cy={12} r={9} {...stroke} />
          <Line x1={3} y1={12} x2={21} y2={12} {...stroke} />
          <Line x1={12} y1={3} x2={12} y2={21} {...stroke} />
          <Path d="M5.6 5.6 C9 8.5 9 15.5 5.6 18.4" {...stroke} />
          <Path d="M18.4 5.6 C15 8.5 15 15.5 18.4 18.4" {...stroke} />
        </>
      )}
      {tab === 'stats' && (
        <>
          <Rect x={4} y={13} width={4} height={7} rx={1} fill={color} />
          <Rect x={10} y={8} width={4} height={12} rx={1} fill={color} />
          <Rect x={16} y={4} width={4} height={16} rx={1} fill={color} />
        </>
      )}
      {tab === 'heat' &&
        HEAT_ICON_OPACITY.map((opacity, i) => (
          <Rect
            key={i}
            x={3 + (i % 3) * 6.5}
            y={3 + Math.floor(i / 3) * 6.5}
            width={5}
            height={5}
            rx={1}
            fill={color}
            opacity={opacity}
          />
        ))}
      {tab === 'practice' && (
        <>
          <Circle cx={12} cy={12} r={9} {...stroke} />
          <Circle cx={12} cy={12} r={5} {...stroke} />
          <Circle cx={12} cy={12} r={1.8} fill={color} />
        </>
      )}
      {tab === 'practiceCharts' && (
        <>
          <Path d="M3 4 V20 H21" {...stroke} />
          <Path d="M6.5 15 L11 10 L14.5 13 L20 7" {...stroke} strokeLinejoin="round" />
        </>
      )}
      {tab === 'nbaLive' && (
        <>
          <Rect x={3} y={5} width={18} height={12} rx={2} {...stroke} />
          <Line x1={9} y1={21} x2={15} y2={21} {...stroke} />
          <Line x1={12} y1={17} x2={12} y2={21} {...stroke} />
          <Circle cx={12} cy={11} r={2.5} fill={color} />
        </>
      )}
      {tab === 'settings' && (
        <>
          <Line x1={4} y1={7} x2={20} y2={7} {...stroke} />
          <Circle cx={15} cy={7} r={2.8} fill={color} />
          <Line x1={4} y1={17} x2={20} y2={17} {...stroke} />
          <Circle cx={9} cy={17} r={2.8} fill={color} />
        </>
      )}
    </Svg>
  );
}
