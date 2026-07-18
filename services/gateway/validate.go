// Payload validation (L2): strict JSON decoding — unknown fields rejected —
// plus go-playground/validator struct tags on every payload.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"

	"github.com/go-playground/validator/v10"
	"github.com/gofiber/fiber/v3"
)

var validate = validator.New(validator.WithRequiredStructEnabled())

// decodeStrict parses the request body into T, rejecting unknown fields,
// trailing garbage, and anything failing the struct's validate tags.
func decodeStrict[T any](c fiber.Ctx) (*T, error) {
	var payload T
	dec := json.NewDecoder(bytes.NewReader(c.Body()))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&payload); err != nil {
		return nil, err
	}
	if dec.More() {
		return nil, errors.New("trailing data after JSON body")
	}
	if _, err := dec.Token(); err != nil && err != io.EOF {
		return nil, errors.New("trailing data after JSON body")
	}
	if err := validate.Struct(&payload); err != nil {
		return nil, err
	}
	return &payload, nil
}

func badRequest(c fiber.Ctx, err error) error {
	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request", "detail": err.Error()})
}
