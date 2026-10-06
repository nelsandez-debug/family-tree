export interface Person {
	id: string;
	name: string;
	birth: string | null;
	death: string | null;
	location: string | null;
	bio: string;
	photoVersion: number;
	x: number;
	y: number;
}

export interface Link {
	id: string;
	childId: string;
	parentId: string;
	type: "parent" | "partner";
}

export interface Tree {
	people: Person[];
	edges: Link[];
}

export type PersonFields = Partial<
	Pick<Person, "name" | "birth" | "death" | "location" | "bio" | "x" | "y">
>;
