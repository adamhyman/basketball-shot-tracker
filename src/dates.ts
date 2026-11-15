

export const formatDate = (date: number) =>
  new Date(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

export const startOfDay = (date: number) => new Date(date).setHours(0, 0, 0, 0);

export const addDays = (date: number, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.getTime();
};
