package graphqlbackend

import (
	"context"

	"github.com/graph-gophers/graphql-go"

	"github.com/sourcegraph/sourcegraph/cmd/frontend/graphqlbackend/graphqlutil"
	"github.com/sourcegraph/sourcegraph/internal/conf"
	"github.com/sourcegraph/sourcegraph/internal/database"
	"github.com/sourcegraph/sourcegraph/lib/errors"
)

var ErrExtensionsDisabled = errors.New("extensions are disabled in site configuration (contact the site admin to enable extensions)")

func (r *schemaResolver) ExtensionRegistry(ctx context.Context) (ExtensionRegistryResolver, error) {
	reg := ExtensionRegistry(r.db)
	if conf.Extensions() == nil {
		if !reg.ImplementsLocalExtensionRegistry() {
			// The OSS build doesn't implement a local extension registry, so the reason for
			// extensions being disabled is probably that the OSS build is in use.
			return nil, errors.New("no extension registry is available (use Sourcegraph Free or Sourcegraph Enterprise to access the Sourcegraph extension registry and/or to host a private internal extension registry)")
		}

		return nil, ErrExtensionsDisabled
	}
	return reg, nil
}

// ExtensionRegistry is the implementation of the GraphQL type ExtensionRegistry.
var ExtensionRegistry func(db database.DB) ExtensionRegistryResolver

// ExtensionRegistryResolver is the interface for the GraphQL type ExtensionRegistry.
//
// Some methods are only implemented if there is a local extension registry. For these methods, the
// implementation (if one exists) is set on the XyzFunc struct field.
type ExtensionRegistryResolver interface {
	Extensions(context.Context, *RegistryExtensionConnectionArgs) (RegistryExtensionConnection, error)

	ImplementsLocalExtensionRegistry() bool // not exposed via GraphQL
	// FilterRemoteExtensions enforces `allowRemoteExtensions` by returning a
	// new slice with extension IDs that were present in
	// `allowRemoteExtensions`. It returns the original extension IDs if
	// `allowRemoteExtensions` is not set.
	FilterRemoteExtensions([]string) []string // not exposed via GraphQL
}

type RegistryExtensionConnectionArgs struct {
	graphqlutil.ConnectionArgs
	ExtensionIDs *[]string
}

// NodeToRegistryExtension is called to convert GraphQL node values to values of type
// RegistryExtension. It is assigned at init time.
var NodeToRegistryExtension func(any) (RegistryExtension, bool)

// RegistryExtensionByID is called to look up values of GraphQL type RegistryExtension. It is
// assigned at init time.
var RegistryExtensionByID func(context.Context, database.DB, graphql.ID) (RegistryExtension, error)

// RegistryExtension is the interface for the GraphQL type RegistryExtension.
type RegistryExtension interface {
	ID() graphql.ID
	ExtensionID() string
	Manifest(ctx context.Context) (ExtensionManifest, error)
}

// ExtensionManifest is the interface for the GraphQL type ExtensionManifest.
type ExtensionManifest interface {
	Raw() string
	JSONFields(*struct{ Fields []string }) JSONValue
}

// RegistryExtensionConnection is the interface for the GraphQL type RegistryExtensionConnection.
type RegistryExtensionConnection interface {
	Nodes(context.Context) ([]RegistryExtension, error)
}
