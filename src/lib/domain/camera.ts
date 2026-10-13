/** Browser-visible camera state contains app URLs only, never upstream addresses. */
export interface CameraDescriptor {
	configured: boolean;
	generation: number;
	name: string;
	streamUrl: string | null;
	mseUrl: string | null;
	snapshotUrl: string | null;
	rotation: 0 | 90 | 180 | 270;
	flipHorizontal: boolean;
	flipVertical: boolean;
}
