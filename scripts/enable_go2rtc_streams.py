from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from ruamel.yaml import YAML

from viseron.config import load_config


CONFIG_PATH = Path("/config/config.yaml")
STREAM_FORMAT_PROTOCOLS = {
    "rtsp": "rtsp",
    "mjpeg": "http",
    "hls": "http",
    "rtmp": "rtmp",
}


def stream_url(camera_config: dict, stream_config: dict) -> str | None:
    stream_format = stream_config.get("stream_format")
    protocol = stream_config.get("protocol") or STREAM_FORMAT_PROTOCOLS.get(
        stream_format
    )
    if protocol not in {"rtsp", "rtsps"}:
        return None

    host = camera_config.get("host")
    port = stream_config.get("port")
    path = stream_config.get("path")
    if not host or not port or not path:
        return None

    username = camera_config.get("username")
    password = camera_config.get("password")
    auth = ""
    if username is not None and password is not None:
        auth = f"{quote(str(username), safe='')}:{quote(str(password), safe='')}@"

    return f"{protocol}://{auth}{host}:{port}{path}"


def main() -> None:
    yaml = YAML()
    yaml.preserve_quotes = True
    config = yaml.load(CONFIG_PATH)
    backup_path = CONFIG_PATH.with_suffix(".yaml.before-go2rtc")
    if not backup_path.exists():
        yaml.dump(config, backup_path)

    resolved_config = load_config(create_default=False)
    cameras = ((resolved_config.get("ffmpeg") or {}).get("camera") or {})

    streams = {}
    skipped = []
    for camera_id, camera_config in cameras.items():
        url = stream_url(camera_config, camera_config)
        if url:
            streams[camera_id] = [url]
            continue
        skipped.append(camera_id)

    go2rtc = config.setdefault("go2rtc", {})
    go2rtc["streams"] = streams

    yaml.dump(config, CONFIG_PATH)

    print(f"configured_streams={len(streams)}")
    print(f"skipped_non_rtsp={len(skipped)}")
    if skipped:
        print("skipped=" + ",".join(skipped))


if __name__ == "__main__":
    main()
