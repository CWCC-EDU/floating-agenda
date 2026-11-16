declare module 'lunar-javascript' {
  interface LunarDate {
    getJieQi(): string;
    getDayYi(): string[];
    getDayJi(): string[];
  }

  interface SolarDate {
    getLunar(): LunarDate;
  }

  export const Solar: {
    fromYmd(year: number, month: number, day: number): SolarDate;
  };
}
