#!/usr/bin/env python3
"""Retired 2026-10-01.

This script built the preview homepage, index1.html. On 2026-10-01 that page
became index.html (build/cutover_homepage.py) and index1.html became a stub
that sends visitors to /. Its pristine source is not in the repo, so it
cannot be replayed. Future homepage changes target index.html with a new,
anchor-asserted patch script.
"""
import sys
sys.exit("retired 2026-10-01: the homepage is index.html now; see this file's docstring")
