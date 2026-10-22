<!-- Shared decorative sky: fixed-size tiles keep the same star scale in every container. -->
<div class="night-sky" aria-hidden="true">
	<!-- Static baseline sky (majority of stars do not animate) -->
	<div class="stars stars-static-deep"></div>
	<div class="stars stars-static-mid"></div>

	<!-- Sparse, subtle twinkling layers -->
	<div class="stars stars-twinkle-a"></div>
	<div class="stars stars-twinkle-b"></div>

	<!-- Prominent stars with ultra-subtle halo and gentle shimmer -->
	<div class="stars stars-bright"></div>
</div>

<style>
	.night-sky {
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			radial-gradient(ellipse at 50% 100%, #0d1b2a66 0%, #070b1533 45%, #02030766 100%), var(--rail);
		overflow: hidden;
		pointer-events: none;
	}

	.stars {
		position: absolute;
		inset: 0;
		background-repeat: repeat;
	}

	/* 1. STATIC DEEP FIELD: Faint pinpoint dust, completely still */
	.stars-static-deep {
		background-image:
			radial-gradient(1px 1px at 18px 25px, #ffffff, transparent),
			radial-gradient(0.8px 0.8px at 62px 88px, #fff4ea, transparent),
			radial-gradient(1px 1px at 115px 40px, #cad7ff, transparent),
			radial-gradient(0.8px 0.8px at 142px 165px, #ffffff, transparent),
			radial-gradient(1px 1px at 188px 112px, #ffd2a1, transparent),
			radial-gradient(0.8px 0.8px at 35px 175px, #ffffff, transparent),
			radial-gradient(1px 1px at 95px 135px, #cad7ff, transparent);
		background-size: 211px 211px;
		opacity: 0.45;
	}

	/* 2. STATIC MID FIELD: Medium stars, completely still */
	.stars-static-mid {
		background-image:
			radial-gradient(1.2px 1.2px at 45px 60px, #9bb0ff, transparent),
			radial-gradient(1px 1px at 130px 15px, #ffffff, transparent),
			radial-gradient(1.3px 1.3px at 210px 180px, #fff4ea, transparent),
			radial-gradient(1px 1px at 85px 240px, #cad7ff, transparent),
			radial-gradient(1.2px 1.2px at 265px 95px, #ffd2a1, transparent),
			radial-gradient(1.1px 1.1px at 165px 275px, #ffffff, transparent);
		background-size: 317px 317px;
		opacity: 0.7;
	}

	/* 3. TWINKLE GROUP A: Sparse stars, gentle atmospheric dip */
	.stars-twinkle-a {
		background-image:
			radial-gradient(1.3px 1.3px at 70px 140px, #ffd2a1, transparent),
			radial-gradient(1.2px 1.2px at 280px 65px, #ffffff, transparent),
			radial-gradient(1.4px 1.4px at 360px 310px, #cad7ff, transparent);
		background-size: 439px 439px;
		animation: scintillation-gentle 4.7s ease-in-out infinite;
	}

	/* 4. TWINKLE GROUP B: Sparse stars, slower irregular shimmer */
	.stars-twinkle-b {
		background-image:
			radial-gradient(1.4px 1.4px at 110px 90px, #ffffff, transparent),
			radial-gradient(1.2px 1.2px at 340px 230px, #9bb0ff, transparent),
			radial-gradient(1.3px 1.3px at 210px 440px, #fff4ea, transparent);
		background-size: 523px 523px;
		animation: scintillation-calm 7.3s ease-in-out infinite;
		animation-delay: -2.9s;
	}

	/* 5. BRIGHT PROMINENT STARS: Tight, barely-there halo + subtle shimmer */
	.stars-bright {
		background-image:
            /* Star 1 (Blue-White) */
			radial-gradient(1.6px 1.6px at 140px 180px, #ffffff, transparent),
			radial-gradient(4px 4px at 140px 180px, rgba(155, 176, 255, 0.09), transparent),
			/* Star 2 (Warm Sun/Orange) */
			radial-gradient(1.8px 1.8px at 460px 340px, #fff4ea, transparent),
			radial-gradient(4.5px 4.5px at 460px 340px, rgba(255, 204, 111, 0.08), transparent),
			/* Star 3 (Pure White) */ radial-gradient(1.6px 1.6px at 310px 560px, #ffffff, transparent),
			radial-gradient(3.5px 3.5px at 310px 560px, rgba(255, 255, 255, 0.08), transparent);
		background-size: 673px 673px;
		animation: bright-shimmer 5.9s ease-in-out infinite;
	}

	/* --- SUBTLE ATMOSPHERIC KEYFRAMES --- */

	/* Mostly steady with two gentle, brief atmospheric dips */
	@keyframes scintillation-gentle {
		0%,
		100% {
			opacity: 0.85;
		}

		20% {
			opacity: 0.9;
		}

		26% {
			opacity: 0.52;
		}

		32% {
			opacity: 0.85;
		}

		68% {
			opacity: 0.88;
		}

		75% {
			opacity: 0.62;
		}

		82% {
			opacity: 0.85;
		}
	}

	/* Slow, soft wave of atmospheric variation */
	@keyframes scintillation-calm {
		0%,
		100% {
			opacity: 0.75;
		}

		30% {
			opacity: 0.92;
		}

		48% {
			opacity: 0.58;
		}

		65% {
			opacity: 0.88;
		}

		85% {
			opacity: 0.65;
		}
	}

	/* Crisp, subtle shimmer for 1st-magnitude stars */
	@keyframes bright-shimmer {
		0%,
		100% {
			opacity: 0.9;
		}

		15% {
			opacity: 0.68;
		}

		21% {
			opacity: 0.95;
		}

		55% {
			opacity: 0.92;
		}

		62% {
			opacity: 0.72;
		}

		68% {
			opacity: 0.9;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.stars {
			animation: none;
		}
		.stars-twinkle-a {
			opacity: 0.85;
		}
		.stars-twinkle-b {
			opacity: 0.75;
		}
		.stars-bright {
			opacity: 0.9;
		}
	}
</style>
