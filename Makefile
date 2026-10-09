PORT ?= 8811
PY ?= .venv/bin/python

.PHONY: serve setup film video film-en stills check clean

# Open http://127.0.0.1:8811/ after this (?lang=ja for Japanese, ?t=moon for moonlight, ?film plays the video)
serve:
	python3 -m http.server $(PORT) --bind 127.0.0.1 --directory web

setup:
	python3 -m venv .venv
	.venv/bin/pip install -r requirements.txt
	.venv/bin/playwright install chromium

# the film, frame by frame (1080x1350 PNG, 60 fps), then the mp4
film:
	$(PY) tools/render.py build/frames 0 -1 60

video:
	sh tools/encode.sh build/frames build/susuki.mp4

# the lens version, drawn at 3x (1620x2025) and scaled down to 1080x1350
film-en:
	SCALE=3 FILM_Q='&v=en' $(PY) tools/render.py build/frames_en 0 -1 60
	sh tools/encode.sh build/frames_en build/susuki_en.mp4

stills:
	$(PY) tools/render.py build/stills --at 0 4.5 6.6 9.5 14.9

# pyflakes, then the page at desktop and phone size: frame rate, errors, a drag, moonlight
check:
	$(PY) -m pyflakes tools
	$(PY) tools/check_page.py build/page

clean:
	rm -rf build
