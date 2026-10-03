package provider

import (
	"context"
	"errors"
	"strings"

	"github.com/nex-crm/wuphf/internal/bot"
	"github.com/nex-crm/wuphf/internal/config"
)

// RunConfiguredOneShot runs a single-shot generation using the active LLM
// provider's OneShot implementation. OpenAI-compatible providers use their
// HTTP stream for a text-only completion, without requiring a local CLI.
func RunConfiguredOneShot(systemPrompt, prompt, cwd string) (string, error) {
	return RunConfiguredOneShotCtx(context.Background(), systemPrompt, prompt, cwd)
}

// RunConfiguredOneShotCtx is like RunConfiguredOneShot, but cancellation is
// propagated into providers that expose a context-aware one-shot hook.
func RunConfiguredOneShotCtx(ctx context.Context, systemPrompt, prompt, cwd string) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}

	kind := config.ResolveLLMProvider("")
	if e := Lookup(kind); e != nil && e.Capabilities.SupportsOneShot {
		if e.OneShotCtx != nil {
			return e.OneShotCtx(ctx, systemPrompt, prompt, cwd)
		}
		if e.OneShot != nil {
			return runLegacyOneShotCtx(ctx, e.OneShot, systemPrompt, prompt, cwd)
		}
	}
	if baseURL, _ := OpenAICompatDefaults(kind); baseURL != "" {
		messages := []bot.Message{{Role: "system", Content: systemPrompt}, {Role: "user", Content: prompt}}
		var result strings.Builder
		var streamErr error
		for chunk := range NewOpenAICompatStreamFnWithCtx(ctx, kind)(messages, nil) {
			switch chunk.Type {
			case "text":
				result.WriteString(chunk.Content)
			case "error":
				streamErr = errors.New(chunk.Content)
			}
		}
		if err := ctx.Err(); err != nil {
			return "", err
		}
		if streamErr != nil {
			return "", streamErr
		}
		if strings.TrimSpace(result.String()) == "" {
			return "", errors.New("OpenAI-compatible provider returned no text")
		}
		return strings.TrimSpace(result.String()), nil
	}
	return RunClaudeOneShotCtx(ctx, systemPrompt, prompt, cwd)
}

// runLegacyOneShotCtx unblocks the caller on context cancellation, but the
// wrapped legacy fn and any subprocess it spawned continue until natural
// completion. All currently registered providers implement OneShotCtx, so this
// branch is effectively unreachable and only avoids a regression if a legacy
// provider is reintroduced.
func runLegacyOneShotCtx(ctx context.Context, fn func(systemPrompt, prompt, cwd string) (string, error), systemPrompt, prompt, cwd string) (string, error) {
	if ctx.Done() == nil {
		return fn(systemPrompt, prompt, cwd)
	}

	type result struct {
		text string
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		t, e := fn(systemPrompt, prompt, cwd)
		ch <- result{t, e}
	}()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case r := <-ch:
		return r.text, r.err
	}
}
