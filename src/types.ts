export interface Person {
	id: string;
	name: string;
	nickname: string | null;
	middleName: string | null;
	maidenName: string | null;
	birth: string | null;
	birthPlace: string | null;
	death: string | null;
	deathPlace: string | null;
	location: string | null;
	occupation: string | null;
	bio: string;
	photoVersion: number;
	x: number;
	y: number;
}

export type ParentKind = "biological" | "adoptive" | "step" | "foster";
export type PartnerKind =
	| "married"
	| "partner"
	| "engaged"
	| "divorced"
	| "separated"
	| "widowed";

/**
 * A parent link runs childId -> parentId. A partner link joins the two people
 * stored in childId/parentId; their order doesn't matter.
 */
export interface Link {
	id: string;
	childId: string;
	parentId: string;
	type: "parent" | "partner";
	subtype: ParentKind | PartnerKind;
	startDate: string | null;
	startPlace: string | null;
	endDate: string | null;
}

export interface Tree {
	people: Person[];
	edges: Link[];
}

export interface TrashedPerson extends Person {
	deletedAt: number;
}

export type PersonFields = Partial<
	Omit<Person, "id" | "photoVersion">
>;

export type LinkFields = Partial<
	Pick<Link, "subtype" | "startDate" | "startPlace" | "endDate">
>;

export const PARENT_KINDS: ParentKind[] = ["biological", "adoptive", "step", "foster"];
export const PARTNER_KINDS: PartnerKind[] = [
	"married",
	"partner",
	"engaged",
	"divorced",
	"separated",
	"widowed",
];
