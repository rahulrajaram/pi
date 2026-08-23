#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ensure_llama_local_server() {
  local provider=""
  local model=""
  local next_is_provider=false
  local next_is_model=false

  for arg in "${ARGS[@]}"; do
    if [[ "$next_is_provider" == "true" ]]; then
      provider="$arg"
      next_is_provider=false
      continue
    fi
    if [[ "$next_is_model" == "true" ]]; then
      model="$arg"
      next_is_model=false
      continue
    fi

    case "$arg" in
      --provider)
        next_is_provider=true
        ;;
      --provider=*)
        provider="${arg#--provider=}"
        ;;
      --model)
        next_is_model=true
        ;;
      --model=*)
        model="${arg#--model=}"
        ;;
    esac
  done

  if [[ "$provider" != "llama-local" ]]; then
    return
  fi

  local llama_server="${PI_LLAMA_SERVER:-$HOME/.local/bin/llama-server}"
  local model_path="${PI_LLAMA_MODEL_PATH:-$HOME/.cache/llmfit/models/Qwen2.5-Coder-7B-Instruct-Q6_K.gguf}"
  local chat_template="${PI_LLAMA_CHAT_TEMPLATE:-$HOME/Documents/llama.cpp/models/templates/Qwen-Qwen2.5-7B-Instruct.jinja}"
  local alias_name="${PI_LLAMA_MODEL_ALIAS:-${model:-qwen2.5-coder-7b-q6}}"
  local host="${PI_LLAMA_HOST:-127.0.0.1}"
  local port="${PI_LLAMA_PORT:-8081}"
  local ctx="${PI_LLAMA_CTX:-32768}"
  local log_file="${PI_LLAMA_LOG:-/tmp/pi-qwen-llama-server.log}"
  local pid_file="${PI_LLAMA_PID_FILE:-/tmp/pi-qwen-llama-server.pid}"
  local models_url="http://$host:$port/v1/models"

  if [[ ! -x "$llama_server" ]]; then
    echo "llama-local requested but llama-server is not executable: $llama_server" >&2
    exit 1
  fi
  if [[ ! -f "$model_path" ]]; then
    echo "llama-local requested but model file is missing: $model_path" >&2
    exit 1
  fi
  if [[ ! -f "$chat_template" ]]; then
    echo "llama-local requested but chat template is missing: $chat_template" >&2
    exit 1
  fi

  if command -v curl >/dev/null 2>&1; then
    local current_models=""
    current_models="$(curl -fsS "$models_url" 2>/dev/null || true)"
    if [[ "$current_models" == *"\"id\":\"$alias_name\""* && "$current_models" == *"\"n_ctx\":$ctx"* ]]; then
      return
    fi
  fi

  if [[ -f "$pid_file" ]]; then
    local old_pid
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]] && ps -p "$old_pid" >/dev/null 2>&1; then
      kill "$old_pid" 2>/dev/null || true
      sleep 1
    fi
  fi

  pkill -f "$llama_server .*--port $port .*--alias $alias_name" 2>/dev/null || true

  nohup "$llama_server" \
    -m "$model_path" \
    --fit on \
    --fit-ctx "$ctx" \
    --chat-template-file "$chat_template" \
    --parallel 1 \
    --host "$host" \
    --port "$port" \
    --alias "$alias_name" \
    > "$log_file" 2>&1 &

  echo "$!" > "$pid_file"

  if command -v curl >/dev/null 2>&1; then
    for _ in {1..60}; do
      local started_models
      started_models="$(curl -fsS "$models_url" 2>/dev/null || true)"
      if [[ "$started_models" == *"\"id\":\"$alias_name\""* && "$started_models" == *"\"n_ctx\":$ctx"* ]]; then
        return
      fi
      sleep 1
    done
  else
    sleep 6
    return
  fi

  echo "llama-local server did not become ready at $models_url. Last log lines:" >&2
  tail -80 "$log_file" >&2 || true
  exit 1
}

# Check for --no-env flag
NO_ENV=false
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--no-env" ]]; then
    NO_ENV=true
  else
    ARGS+=("$arg")
  fi
done

if [[ "$NO_ENV" == "true" ]]; then
  # Unset API keys (see packages/ai/src/env-api-keys.ts)
  unset ANTHROPIC_API_KEY
  unset ANTHROPIC_OAUTH_TOKEN
  unset OPENAI_API_KEY
  unset GEMINI_API_KEY
  unset GROQ_API_KEY
  unset CEREBRAS_API_KEY
  unset XAI_API_KEY
  unset OPENROUTER_API_KEY
  unset ZAI_API_KEY
  unset MISTRAL_API_KEY
  unset MINIMAX_API_KEY
  unset MINIMAX_CN_API_KEY
  unset AI_GATEWAY_API_KEY
  unset OPENCODE_API_KEY
  unset COPILOT_GITHUB_TOKEN
  unset GH_TOKEN
  unset GITHUB_TOKEN
  unset HF_TOKEN
  unset GOOGLE_APPLICATION_CREDENTIALS
  unset GOOGLE_CLOUD_PROJECT
  unset GCLOUD_PROJECT
  unset GOOGLE_CLOUD_LOCATION
  unset AWS_PROFILE
  unset AWS_ACCESS_KEY_ID
  unset AWS_SECRET_ACCESS_KEY
  unset AWS_SESSION_TOKEN
  unset AWS_REGION
  unset AWS_DEFAULT_REGION
  unset AWS_BEARER_TOKEN_BEDROCK
  unset AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
  unset AWS_CONTAINER_CREDENTIALS_FULL_URI
  unset AWS_WEB_IDENTITY_TOKEN_FILE
  unset AZURE_OPENAI_API_KEY
  unset AZURE_OPENAI_BASE_URL
  unset AZURE_OPENAI_RESOURCE_NAME
  echo "Running without API keys..."
fi

ensure_llama_local_server

"$SCRIPT_DIR/node_modules/.bin/tsx" --tsconfig "$SCRIPT_DIR/tsconfig.json" "$SCRIPT_DIR/packages/coding-agent/src/cli.ts" ${ARGS[@]+"${ARGS[@]}"}
