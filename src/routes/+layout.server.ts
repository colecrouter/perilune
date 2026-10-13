export function load({ locals }: { locals: App.Locals }) {
	const user = locals.identity?.user;
	return { user: user ? { id: user.id, name: user.name, role: user.role } : null };
}
