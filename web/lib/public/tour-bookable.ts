import { TicketType } from '@shared/constants/enums';

// Compuerta por tour (spec 0034): la cláusula 3 de los términos dice que la página de cada tour
// publica qué no incluye, los requisitos y las edades del tiquete de niño, y que esa información
// obliga al operador. Un tour que no la tiene no se puede reservar.

type TourInfo = {
  excludes_es: string;
  excludes_en: string;
  requirements_es: string;
  requirements_en: string;
  child_age_min: number | null;
  child_age_max: number | null;
};

type PricingRow = { ticket_type: string };

const filled = (text: string) => text.trim().length > 0;

export function isTourBookable(tour: TourInfo, pricing: readonly PricingRow[]): boolean {
  const infoComplete =
    filled(tour.excludes_es) &&
    filled(tour.excludes_en) &&
    filled(tour.requirements_es) &&
    filled(tour.requirements_en);
  const sellsChildTickets = pricing.some((row) => row.ticket_type === TicketType.Child);
  const childAgesSet = tour.child_age_min !== null && tour.child_age_max !== null;
  return infoComplete && (!sellsChildTickets || childAgesSet);
}
