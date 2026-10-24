# Installation settings

Available since **0.1.0-alpha.1**. Edit the install bundle’s private `.env`, then
recreate the affected services at an idle time. Node/source processes read
exported environment variables instead. The complete editable defaults ship in
[`.env.example`](../.env.example).

| Setting                                          | Purpose                                                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `PERILUNE_IMAGE`                                 | Exact published image digest; explicit updates only.                                                                              |
| `COMPOSE_PROJECT_NAME`                           | Stable installation identity; default `perilune`.                                                                                 |
| `PERILUNE_DATA_VOLUME`                           | Release bundle data volume; default `perilune-data`. Use a new volume for restore.                                                |
| `PERILUNE_BACKUP_VOLUME`                         | Release bundle backup volume; default `perilune-backups`.                                                                         |
| `PERILUNE_ORIGIN`                                | Exact browser-visible origin; HTTPS except loopback.                                                                              |
| `PERILUNE_MOONRAKER_URL`                         | Backend WebSocket URL; empty means simulator.                                                                                     |
| `PERILUNE_MOONRAKER_API_KEY`                     | Optional private Moonraker credential.                                                                                            |
| `PERILUNE_AUTH_SECRET`                           | Optional 32+ character secret; otherwise the adjacent private file is authoritative.                                              |
| `COMPOSE_FILE`                                   | Keep selected camera/USB overrides active across commands.                                                                        |
| `PERILUNE_CAMERA_COMPANION_URL`                  | Private go2rtc API; managed camera override sets this.                                                                            |
| `PERILUNE_CAMERA_DEVICE`                         | One explicitly mapped Linux USB device, preferably a stable by-id path.                                                           |
| `PERILUNE_PRINTER_WEB_ORIGIN`                    | Printer web origin for relative webcam URLs.                                                                                      |
| `PERILUNE_CAMERA_MEMORY`, `PERILUNE_CAMERA_CPUS` | Managed companion limits; defaults 384 MiB and 2 CPUs.                                                                            |
| `PERILUNE_KLIPPER_WORKING_DIRECTORY`             | Private Klipper process cwd, only for relative config paths.                                                                      |
| `PERILUNE_LIVE_CONTROLS`                         | Shared physical motion/heaters/jobs and live file changes; default false.                                                         |
| `PERILUNE_LIVE_CONSOLE`                          | Reviewed console/macros, also requiring live controls.                                                                            |
| `PERILUNE_LIVE_FILAMENT`                         | Attended filament movement, also requiring live controls.                                                                         |
| `PERILUNE_LIVE_Z_CALIBRATION`                    | Attended manual Z workflow, also requiring live controls.                                                                         |
| `PERILUNE_LIVE_PID`                              | Attended heater tuning, also requiring live controls.                                                                             |
| `PERILUNE_LIVE_MESH`                             | Physical bed-mesh workflow and reviewed persistence/restart.                                                                      |
| `PERILUNE_LIVE_CONFIGURATION`                    | Reviewed configuration writes and restart.                                                                                        |
| `PERILUNE_SMTP_*`                                | Optional mail delivery; see [email setup](account-email.md).                                                                      |
| `PERILUNE_DATABASE`                              | Direct-Node database path. Container default is `/app/data/perilune.sqlite`; source `.env` does not override that container path. |

All live options default to false. Enabling them is a separate attended acceptance
step, not part of installation. Camera credentials are entered in owner settings
and stored privately. UI display/layout, notification preferences, slicer keys and
paired browsers are managed inside Perilune rather than environment variables.
Keep secrets out of screenshots, issue reports and public configuration files.
