@echo off
rem Starts the Grow worker. Run it as the Windows user who is signed in to Claude Code.
cd /d "%~dp0.."
node worker\main.ts
