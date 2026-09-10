/* All money is integer paise to avoid floating-point drift.

   IMPORTANT: the amounts computed here are only the *estimate* the cart
   and checkout show before the order is priced. The POS backend
   re-prices every line from the live catalog and its numbers — returned
   on the create-order response — are the ones actually charged and
   displayed on the confirmation. The browser never sends amounts the
   backend trusts. */

export const toPaise = (rupees: number): number => Math.round(rupees * 100);

export const formatINR = (paise: number): string =>
  `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

/* Exactly 50% advance. Rounded to the nearest paise; the balance is the
   remainder so advance + balance === total, always. */
export const splitAdvance = (
  totalPaise: number,
): { advancePaise: number; balancePaise: number } => {
  const advancePaise = Math.round(totalPaise / 2);
  return { advancePaise, balancePaise: totalPaise - advancePaise };
};
