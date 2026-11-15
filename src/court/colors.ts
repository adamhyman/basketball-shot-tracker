

export type CourtTexture = 'solid' | 'hardwood' | 'parquet';

export type CourtColors = {
  court: string;
  secondary: string; // the texture's alternating tone
  texture: CourtTexture;
  line: string;
  make: string;
  makeBorder: string;
  miss: string;
  foul: string;
  hoop: string;
};

export const DEFAULT_COLORS: CourtColors = {
  court: '#ecc99e',
  secondary: '#dcb382',
  texture: 'solid',
  line: '#ffffff',
  make: '#2f9e44',
  makeBorder: '#ffffff',
  miss: '#e03131',
  foul: '#fab005',
  hoop: '#e8590c',
};
