package graphqlbackend

import (
	"context"
	"net/url"

	"github.com/graph-gophers/graphql-go"
	"github.com/graph-gophers/graphql-go/relay"
	"github.com/inconshreveable/log15"

	"github.com/sourcegraph/sourcegraph/cmd/frontend/auth/providers"
	"github.com/sourcegraph/sourcegraph/cmd/frontend/backend"
	"github.com/sourcegraph/sourcegraph/cmd/frontend/envvar"
	"github.com/sourcegraph/sourcegraph/cmd/frontend/internal/suspiciousnames"
	"github.com/sourcegraph/sourcegraph/internal/api"
	"github.com/sourcegraph/sourcegraph/internal/conf"
	"github.com/sourcegraph/sourcegraph/internal/database"
	"github.com/sourcegraph/sourcegraph/internal/errcode"
	"github.com/sourcegraph/sourcegraph/internal/extsvc"
	"github.com/sourcegraph/sourcegraph/internal/search/result"
	"github.com/sourcegraph/sourcegraph/internal/types"
	"github.com/sourcegraph/sourcegraph/lib/errors"
)

func (r *schemaResolver) User(
	ctx context.Context,
	args struct {
		Username *string
		Email    *string
	},
) (*UserResolver, error) {
	var err error
	var user *types.User
	switch {
	case args.Username != nil:
		user, err = r.db.Users().GetByUsername(ctx, *args.Username)

	case args.Email != nil:
		// 🚨 SECURITY: Only site admins are allowed to look up by email address on
		// Sourcegraph.com, for user privacy reasons.
		if envvar.SourcegraphDotComMode() {
			if err := backend.CheckCurrentUserIsSiteAdmin(ctx, r.db); err != nil {
				return nil, err
			}
		}
		user, err = r.db.Users().GetByVerifiedEmail(ctx, *args.Email)

	default:
		return nil, errors.New("must specify either username or email to look up a user")
	}
	if err != nil {
		if errcode.IsNotFound(err) {
			return nil, nil
		}
		return nil, err
	}
	return NewUserResolver(r.db, user), nil
}

// UserResolver implements the GraphQL User type.
type UserResolver struct {
	db   database.DB
	user *types.User
}

// NewUserResolver returns a new UserResolver with given user object.
func NewUserResolver(db database.DB, user *types.User) *UserResolver {
	return &UserResolver{db: db, user: user}
}

// UserByID looks up and returns the user with the given GraphQL ID. If no such user exists, it returns a
// non-nil error.
func UserByID(ctx context.Context, db database.DB, id graphql.ID) (*UserResolver, error) {
	userID, err := UnmarshalUserID(id)
	if err != nil {
		return nil, err
	}
	return UserByIDInt32(ctx, db, userID)
}

// UserByIDInt32 looks up and returns the user with the given database ID. If no such user exists,
// it returns a non-nil error.
func UserByIDInt32(ctx context.Context, db database.DB, id int32) (*UserResolver, error) {
	user, err := db.Users().GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	return NewUserResolver(db, user), nil
}

func (r *UserResolver) ID() graphql.ID { return MarshalUserID(r.user.ID) }

func MarshalUserID(id int32) graphql.ID { return relay.MarshalID("User", id) }

func UnmarshalUserID(id graphql.ID) (userID int32, err error) {
	err = relay.UnmarshalSpec(id, &userID)
	return
}

// DatabaseID returns the numeric ID for the user in the database.
func (r *UserResolver) DatabaseID() int32 { return r.user.ID }

// Email returns the user's oldest email, if one exists.
// Deprecated: use Emails instead.
func (r *UserResolver) Email(ctx context.Context) (string, error) {
	// 🚨 SECURITY: Only the authenticated user can view their email on
	// Sourcegraph.com.
	if envvar.SourcegraphDotComMode() {
		if err := backend.CheckSameUser(ctx, r.user.ID); err != nil {
			return "", err
		}
	} else {
		// 🚨 SECURITY: Only the user and admins are allowed to access the email address.
		if err := backend.CheckSiteAdminOrSameUser(ctx, r.db, r.user.ID); err != nil {
			return "", err
		}
	}

	email, _, err := database.UserEmails(r.db).GetPrimaryEmail(ctx, r.user.ID)
	if err != nil && !errcode.IsNotFound(err) {
		return "", err
	}

	return email, nil
}

func (r *UserResolver) Username() string { return r.user.Username }

func (r *UserResolver) DisplayName() *string {
	if r.user.DisplayName == "" {
		return nil
	}
	return &r.user.DisplayName
}

func (r *UserResolver) BuiltinAuth() bool {
	return r.user.BuiltinAuth && providers.BuiltinAuthEnabled()
}

func (r *UserResolver) AvatarURL() *string {
	if r.user.AvatarURL == "" {
		return nil
	}
	return &r.user.AvatarURL
}

func (r *UserResolver) URL() string {
	return "/users/" + r.user.Username
}

func (r *UserResolver) SettingsURL() *string { return strptr(r.URL() + "/settings") }

func (r *UserResolver) CreatedAt() DateTime {
	return DateTime{Time: r.user.CreatedAt}
}

func (r *UserResolver) UpdatedAt() *DateTime {
	return &DateTime{Time: r.user.UpdatedAt}
}

func (r *UserResolver) settingsSubject() api.SettingsSubject {
	return api.SettingsSubject{User: &r.user.ID}
}

func (r *UserResolver) LatestSettings(ctx context.Context) (*settingsResolver, error) {
	// 🚨 SECURITY: Only the authenticated user can view their settings on
	// Sourcegraph.com.
	if envvar.SourcegraphDotComMode() {
		if err := backend.CheckSameUser(ctx, r.user.ID); err != nil {
			return nil, err
		}
	} else {
		// 🚨 SECURITY: Only the user and admins are allowed to access the user's
		// settings, because they may contain secrets or other sensitive data.
		if err := backend.CheckSiteAdminOrSameUser(ctx, r.db, r.user.ID); err != nil {
			return nil, err
		}
	}

	settings, err := r.db.Settings().GetLatest(ctx, r.settingsSubject())
	if err != nil {
		return nil, err
	}
	if settings == nil {
		return nil, nil
	}
	return &settingsResolver{r.db, &settingsSubject{user: r}, settings, nil}, nil
}

func (r *UserResolver) SettingsCascade() *settingsCascade {
	return &settingsCascade{db: r.db, subject: &settingsSubject{user: r}}
}

func (r *UserResolver) ConfigurationCascade() *settingsCascade { return r.SettingsCascade() }

func (r *UserResolver) SiteAdmin(ctx context.Context) (bool, error) {
	// 🚨 SECURITY: Only the user and admins are allowed to determine if the user is a site admin.
	if err := backend.CheckSiteAdminOrSameUser(ctx, r.db, r.user.ID); err != nil {
		return false, err
	}

	return r.user.SiteAdmin, nil
}

func (r *UserResolver) TosAccepted(ctx context.Context) bool {
	return r.user.TosAccepted
}

func (r *UserResolver) Searchable(ctx context.Context) bool {
	return r.user.Searchable
}

type updateUserArgs struct {
	User        graphql.ID
	Username    *string
	DisplayName *string
	AvatarURL   *string
}

func (r *schemaResolver) UpdateUser(ctx context.Context, args *updateUserArgs) (*UserResolver, error) {
	userID, err := UnmarshalUserID(args.User)
	if err != nil {
		return nil, err
	}

	// 🚨 SECURITY: Only the authenticated user can update their properties on
	// Sourcegraph.com.
	if envvar.SourcegraphDotComMode() {
		if err := backend.CheckSameUser(ctx, userID); err != nil {
			return nil, err
		}
	} else {
		// 🚨 SECURITY: Only the user and site admins are allowed to update the user.
		if err := backend.CheckSiteAdminOrSameUser(ctx, r.db, userID); err != nil {
			return nil, err
		}
	}

	if args.Username != nil {
		if err := suspiciousnames.CheckNameAllowedForUserOrOrganization(*args.Username); err != nil {
			return nil, err
		}
	}

	if args.AvatarURL != nil {
		if len(*args.AvatarURL) > 3000 {
			return nil, errors.New("avatar URL exceeded 3000 characters")
		}

		u, err := url.Parse(*args.AvatarURL)
		if err != nil {
			return nil, errors.Wrap(err, "unable to parse avatar URL")
		} else if u.Scheme != "http" && u.Scheme != "https" {
			return nil, errors.New("avatar URL must be an HTTP or HTTPS URL")
		}
	}

	update := database.UserUpdate{
		DisplayName: args.DisplayName,
		AvatarURL:   args.AvatarURL,
	}
	if args.Username != nil && viewerIsChangingUsername(ctx, r.db, userID, *args.Username) {
		if !viewerCanChangeUsername(ctx, r.db, userID) {
			return nil, errors.Errorf("unable to change username because auth.enableUsernameChanges is false in site configuration")
		}
		update.Username = *args.Username
	}
	if err := r.db.Users().Update(ctx, userID, update); err != nil {
		return nil, err
	}
	return UserByIDInt32(ctx, r.db, userID)
}

// CurrentUser returns the authenticated user if any. If there is no authenticated user, it returns
// (nil, nil). If some other error occurs, then the error is returned.
func CurrentUser(ctx context.Context, db database.DB) (*UserResolver, error) {
	user, err := db.Users().GetByCurrentAuthUser(ctx)
	if err != nil {
		if errcode.IsNotFound(err) || err == database.ErrNoCurrentUser {
			return nil, nil
		}
		return nil, err
	}
	return NewUserResolver(db, user), nil
}

func (r *UserResolver) Organizations(ctx context.Context) (*orgConnectionStaticResolver, error) {
	// 🚨 SECURITY: Only the user and admins are allowed to access the user's
	// organisations.
	if err := backend.CheckSiteAdminOrSameUser(ctx, r.db, r.user.ID); err != nil {
		return nil, err
	}
	orgs, err := r.db.Orgs().GetByUserID(ctx, r.user.ID)
	if err != nil {
		return nil, err
	}
	c := orgConnectionStaticResolver{nodes: make([]*OrgResolver, len(orgs))}
	for i, org := range orgs {
		c.nodes[i] = &OrgResolver{r.db, org}
	}
	return &c, nil
}

func (r *UserResolver) Tags(ctx context.Context) ([]string, error) {
	// 🚨 SECURITY: Only the user and admins are allowed to access the user's tags.
	if err := backend.CheckSiteAdminOrSameUser(ctx, r.db, r.user.ID); err != nil {
		return nil, err
	}
	return r.user.Tags, nil
}

func (r *UserResolver) SurveyResponses(ctx context.Context) ([]*surveyResponseResolver, error) {
	// 🚨 SECURITY: Only the user and admins are allowed to access the user's survey responses.
	if err := backend.CheckSiteAdminOrSameUser(ctx, r.db, r.user.ID); err != nil {
		return nil, err
	}

	responses, err := database.SurveyResponses(r.db).GetByUserID(ctx, r.user.ID)
	if err != nil {
		return nil, err
	}
	surveyResponseResolvers := []*surveyResponseResolver{}
	for _, response := range responses {
		surveyResponseResolvers = append(surveyResponseResolvers, &surveyResponseResolver{r.db, response})
	}
	return surveyResponseResolvers, nil
}

func (r *UserResolver) ViewerCanAdminister(ctx context.Context) (bool, error) {
	// 🚨 SECURITY: Only the authenticated user can administrate themselves on
	// Sourcegraph.com.
	var err error
	if envvar.SourcegraphDotComMode() {
		err = backend.CheckSameUser(ctx, r.user.ID)
	} else {
		err = backend.CheckSiteAdminOrSameUser(ctx, r.db, r.user.ID)
	}
	if errcode.IsUnauthorized(err) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	return true, nil
}

func (r *UserResolver) URLForSiteAdminBilling(ctx context.Context) (*string, error) {
	return EnterpriseResolvers.dotcomResolver.UserURLForSiteAdminBilling(ctx, r.user.ID)
}

func (r *UserResolver) NamespaceName() string { return r.user.Username }

func (r *UserResolver) PermissionsInfo(ctx context.Context) (PermissionsInfoResolver, error) {
	return EnterpriseResolvers.authzResolver.UserPermissionsInfo(ctx, r.ID())
}

func (r *schemaResolver) UpdatePassword(ctx context.Context, args *struct {
	OldPassword string
	NewPassword string
}) (*EmptyResponse, error) {
	// 🚨 SECURITY: Only the authenticated user can change their password.
	user, err := database.Users(r.db).GetByCurrentAuthUser(ctx)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, errors.New("no authenticated user")
	}

	if err := database.Users(r.db).UpdatePassword(ctx, user.ID, args.OldPassword, args.NewPassword); err != nil {
		return nil, err
	}

	if conf.CanSendEmail() {
		if err := backend.UserEmails.SendUserEmailOnFieldUpdate(ctx, r.db, user.ID, "updated the password"); err != nil {
			log15.Warn("Failed to send email to inform user of password update", "error", err)
		}
	}
	return &EmptyResponse{}, nil
}

func (r *schemaResolver) CreatePassword(ctx context.Context, args *struct {
	NewPassword string
}) (*EmptyResponse, error) {
	// 🚨 SECURITY: Only the authenticated user can create their password.
	user, err := database.Users(r.db).GetByCurrentAuthUser(ctx)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, errors.New("no authenticated user")
	}

	if err := database.Users(r.db).CreatePassword(ctx, user.ID, args.NewPassword); err != nil {
		return nil, err
	}

	if conf.CanSendEmail() {
		if err := backend.UserEmails.SendUserEmailOnFieldUpdate(ctx, r.db, user.ID, "created a password"); err != nil {
			log15.Warn("Failed to send email to inform user of password creation", "error", err)
		}
	}
	return &EmptyResponse{}, nil
}

func (r *schemaResolver) SetTosAccepted(ctx context.Context, args *struct{ UserID *graphql.ID }) (*EmptyResponse, error) {
	var affectedUserID int32
	if args.UserID != nil {
		var err error
		affectedUserID, err = UnmarshalUserID(*args.UserID)
		if err != nil {
			return nil, err
		}
	} else {
		user, err := database.Users(r.db).GetByCurrentAuthUser(ctx)
		if err != nil {
			return nil, err
		}

		affectedUserID = user.ID
	}

	// 🚨 SECURITY: Only the user and admins are allowed to set the Terms of Service accepted flag.
	if err := backend.CheckSiteAdminOrSameUser(ctx, r.db, affectedUserID); err != nil {
		return nil, err
	}

	tosAccepted := true
	update := database.UserUpdate{
		TosAccepted: &tosAccepted,
	}

	if err := database.Users(r.db).Update(ctx, affectedUserID, update); err != nil {
		return nil, err
	}

	return &EmptyResponse{}, nil
}

func (r *schemaResolver) SetSearchable(ctx context.Context, args *struct{ Searchable bool }) (*EmptyResponse, error) {
	user, err := database.Users(r.db).GetByCurrentAuthUser(ctx)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, errors.New("no authenticated user")
	}

	searchable := args.Searchable
	update := database.UserUpdate{
		Searchable: &searchable,
	}

	if err := database.Users(r.db).Update(ctx, user.ID, update); err != nil {
		return nil, err
	}

	return &EmptyResponse{}, nil
}

// ViewerCanChangeUsername returns if the current user can change the username of the user.
func (r *UserResolver) ViewerCanChangeUsername(ctx context.Context) bool {
	return viewerCanChangeUsername(ctx, r.db, r.user.ID)
}

// ViewerNeedsCodeHostUpgrade returns true if one of organisations that viewer is a member of has updated their code-host connection (and the user-owned one needs to be updated)
func (r *UserResolver) ViewerNeedsCodeHostUpgrade(ctx context.Context) bool {
	return viewerNeedsCodeHostUpgrade(ctx, r.db, r.user.ID)
}

func (r *UserResolver) BatchChanges(ctx context.Context, args *ListBatchChangesArgs) (BatchChangesConnectionResolver, error) {
	id := r.ID()
	args.Namespace = &id
	return EnterpriseResolvers.batchChangesResolver.BatchChanges(ctx, args)
}

type ListUserRepositoriesArgs struct {
	First             *int32
	Query             *string
	After             *string
	Cloned            bool
	NotCloned         bool
	Indexed           bool
	NotIndexed        bool
	ExternalServiceID *graphql.ID
	OrderBy           *string
	Descending        bool
}

func (r *UserResolver) Repositories(ctx context.Context, args *ListUserRepositoriesArgs) (RepositoryConnectionResolver, error) {
	opt := database.ReposListOptions{}
	if args.Query != nil {
		opt.Query = *args.Query
	}
	if args.First != nil {
		opt.LimitOffset = &database.LimitOffset{Limit: int(*args.First)}
	}
	if args.After != nil {
		cursor, err := UnmarshalRepositoryCursor(args.After)
		if err != nil {
			return nil, err
		}
		opt.Cursors = append(opt.Cursors, cursor)
	} else {
		opt.Cursors = append(opt.Cursors, &types.Cursor{Direction: "next"})
	}
	if args.OrderBy == nil {
		opt.OrderBy = database.RepoListOrderBy{{
			Field:      "name",
			Descending: false,
		}}
	} else {
		opt.OrderBy = database.RepoListOrderBy{{
			Field:      ToDBRepoListColumn(*args.OrderBy),
			Descending: args.Descending,
		}}
	}

	if args.ExternalServiceID == nil {
		opt.UserID = r.user.ID
		opt.IncludeUserPublicRepos = true
	} else {
		id, err := UnmarshalExternalServiceID(*args.ExternalServiceID)
		if err != nil {
			return nil, err
		}
		opt.ExternalServiceIDs = []int64{id}
	}

	return &repositoryConnectionResolver{
		db:         r.db,
		opt:        opt,
		cloned:     args.Cloned,
		notCloned:  args.NotCloned,
		indexed:    args.Indexed,
		notIndexed: args.NotIndexed,
	}, nil
}

func (r *UserResolver) BatchChangesCodeHosts(ctx context.Context, args *ListBatchChangesCodeHostsArgs) (BatchChangesCodeHostConnectionResolver, error) {
	args.UserID = &r.user.ID
	return EnterpriseResolvers.batchChangesResolver.BatchChangesCodeHosts(ctx, args)
}

func viewerNeedsCodeHostUpgrade(ctx context.Context, db database.DB, userID int32) bool {
	if err := backend.CheckSiteAdminOrSameUser(ctx, db, userID); err != nil {
		return false
	}
	if !envvar.SourcegraphDotComMode() {
		return false

	}

	overrides, err := db.FeatureFlags().GetOrgOverridesForUser(ctx, userID)
	if err != nil {
		return false
	}
	potentialUpgradeOrgs := map[int32]struct{}{}
	for _, override := range overrides {
		if override.FlagName == "github-app-cloud" {
			if override.Value == true {
				potentialUpgradeOrgs[*override.OrgID] = struct{}{}
			}
		}
	}
	if len(potentialUpgradeOrgs) == 0 {
		return false
	}
	orgs, err := db.OrgMembers().GetByUserID(ctx, userID)
	if err != nil {
		return false
	}
	if len(orgs) == 0 {
		return false
	}
	queryFor := []int32{}
	for _, o := range orgs {
		if _, ok := potentialUpgradeOrgs[o.OrgID]; ok {
			queryFor = append(queryFor, o.OrgID)
		}
	}
	if len(queryFor) == 0 {
		return false
	}
	orgServices, err := db.ExternalServices().List(ctx, database.ExternalServicesListOptions{Kinds: []string{extsvc.KindGitHub}, NamespaceOrgIDs: queryFor})
	if err != nil {
		return false
	}

	if len(orgServices) == 0 {
		return false
	}
	userServices, err := db.ExternalServices().List(ctx, database.ExternalServicesListOptions{Kinds: []string{extsvc.KindGitHub}, NamespaceUserID: userID})
	if err != nil {
		return false
	}
	if len(userServices) == 0 {
		return false
	}
	for _, os := range orgServices {
		for _, us := range userServices {
			if os.Kind == extsvc.KindGitHub && us.Kind == extsvc.KindGitHub {
				if os.CreatedAt.After(us.UpdatedAt) {
					return true
				}
			}
		}
	}
	return false
}

func viewerCanChangeUsername(ctx context.Context, db database.DB, userID int32) bool {
	if err := backend.CheckSiteAdminOrSameUser(ctx, db, userID); err != nil {
		return false
	}
	if conf.Get().AuthEnableUsernameChanges {
		return true
	}
	// 🚨 SECURITY: Only site admins are allowed to change a user's username when auth.enableUsernameChanges == false.
	return backend.CheckCurrentUserIsSiteAdmin(ctx, db) == nil
}

// Users may be trying to change their own username, or someone else's.
//
// The subjectUserID value represents the decoded user ID from the incoming
// update request, and the proposedUsername is the value that would be applied
// to that subject's record if all security checks pass.
//
// If that subject's username is different from the proposed one, then a
// change is being attempted and may be rejected by viewerCanChangeUsername.
func viewerIsChangingUsername(ctx context.Context, db database.DB, subjectUserID int32, proposedUsername string) bool {
	subject, err := db.Users().GetByID(ctx, subjectUserID)
	if err != nil {
		log15.Warn("viewerIsChangingUsername", "error", err)
		return true
	}
	return subject.Username != proposedUsername
}

func (r *UserResolver) Monitors(ctx context.Context, args *ListMonitorsArgs) (MonitorConnectionResolver, error) {
	if err := backend.CheckSameUser(ctx, r.user.ID); err != nil {
		return nil, err
	}
	return EnterpriseResolvers.codeMonitorsResolver.Monitors(ctx, r.user.ID, args)
}

func (r *UserResolver) PublicRepositories(ctx context.Context) ([]*RepositoryResolver, error) {
	if err := backend.CheckSiteAdminOrSameUser(ctx, r.db, r.user.ID); err != nil {
		return nil, err
	}
	repos, err := database.UserPublicRepos(r.db).ListByUser(ctx, r.user.ID)
	if err != nil {
		return nil, err
	}
	var out []*RepositoryResolver
	for _, repo := range repos {
		out = append(out, &RepositoryResolver{
			RepoMatch: result.RepoMatch{
				ID:   repo.RepoID,
				Name: api.RepoName(repo.RepoURI),
			},
			db: r.db,
			innerRepo: &types.Repo{
				ID: repo.RepoID,
			},
		})
	}
	return out, nil
}
