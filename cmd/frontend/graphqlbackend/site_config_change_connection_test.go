package graphqlbackend

import (
	"context"
	"fmt"
	"strconv"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/sourcegraph/log"
	"github.com/sourcegraph/sourcegraph/internal/actor"
	"github.com/sourcegraph/sourcegraph/internal/database"
	"github.com/sourcegraph/sourcegraph/internal/database/dbtest"
	"github.com/sourcegraph/sourcegraph/internal/types"
)

type siteConfigStubs struct {
	db          database.DB
	users       []*types.User
	siteConfigs []*database.SiteConfig
}

func toStringPtr(n int) *string {
	str := strconv.Itoa(n)

	return &str
}

func setupSiteConfigStubs(t *testing.T) *siteConfigStubs {
	logger := log.NoOp()
	db := database.NewDB(logger, dbtest.NewDB(logger, t))
	ctx := context.Background()

	usersToCreate := []database.NewUser{
		{Username: "foo", DisplayName: "foo user"},
		{Username: "bar", DisplayName: "bar user"},
	}

	var users []*types.User
	for _, input := range usersToCreate {
		user, err := db.Users().Create(ctx, input)
		if err != nil {
			t.Fatal(err)
		}

		if err := db.Users().SetIsSiteAdmin(ctx, user.ID, true); err != nil {
			t.Fatal(err)
		}

		users = append(users, user)
	}

	conf := db.Conf()
	siteConfigsToCreate := []*database.SiteConfig{
		{
			Contents: `
{
  "auth.Providers": []
}`,
		},
		{
			AuthorUserID: 2,
			// A new line is added.
			Contents: `
{
  "disableAutoGitUpdates": true,
  "auth.Providers": []
}`,
		},
		{
			AuthorUserID: 1,
			// Existing line is changed.
			Contents: `
{
  "disableAutoGitUpdates": false,
  "auth.Providers": []
}`,
		},
		{
			AuthorUserID: 1,
			// Existing line is removed.
			Contents: `
{
  "auth.Providers": []
}`,
		},
	}

	lastID := int32(0)
	// This will create 5 entries, because the first time conf.SiteCreateIfupToDate is called it
	// will create two entries in the DB.
	for _, input := range siteConfigsToCreate {
		siteConfig, err := conf.SiteCreateIfUpToDate(ctx, int32Ptr(lastID), input.AuthorUserID, input.Contents, false)
		if err != nil {
			t.Fatal(err)
		}

		lastID = siteConfig.ID
	}

	return &siteConfigStubs{
		db:    db,
		users: users,
		// siteConfigs: siteConfigs,
	}
}

func TestSiteConfigConnection(t *testing.T) {
	stubs := setupSiteConfigStubs(t)

	// Create a context with an admin user as the actor.
	contextWithActor := actor.WithActor(context.Background(), &actor.Actor{UID: 1})

	RunTests(t, []*Test{
		{
			Schema:  mustParseGraphQLSchema(t, stubs.db),
			Label:   "Get first 2 site configuration history",
			Context: contextWithActor,
			Query: `
			{
			  site {
				id
				  configuration {
					id
					  history(first: 2){
						  totalCount
						  nodes{
							  id
							  author{
								  id,
								  username,
								  displayName
							  }
						  }
						  pageInfo {
							hasNextPage
							hasPreviousPage
							endCursor
							startCursor
						  }
					  }
				  }
			  }
			}
		`,
			ExpectedResult: fmt.Sprintf(`
			{
				"site": {
					"id": "U2l0ZToic2l0ZSI=",
					"configuration": {
						"id": 5,
						"history": {
							"totalCount": 5,
							"nodes": [
								{
									"id": %[1]q,
									"author": {
										"id": "VXNlcjox",
										"username": "foo",
										"displayName": "foo user"
									}
								},
								{
									"id": %[2]q,
									"author": {
										"id": "VXNlcjox",
										"username": "foo",
										"displayName": "foo user"
									}
								}
							],
							"pageInfo": {
							  "hasNextPage": true,
							  "hasPreviousPage": false,
							  "endCursor": %[2]q,
							  "startCursor": %[1]q
							}
						}
					}
				}
			}
		`, marshalSiteConfigurationChangeID(5), marshalSiteConfigurationChangeID(4)),
		},
		{
			Schema:  mustParseGraphQLSchema(t, stubs.db),
			Label:   "Get last 3 site configuration history",
			Context: contextWithActor,
			Query: `
					{
						site {
							id
							configuration {
								id
								history(last: 3){
									totalCount
									nodes{
										id
										author{
											id,
											username,
											displayName
										}
									}
									pageInfo {
									  hasNextPage
									  hasPreviousPage
									  endCursor
									  startCursor
									}
								}
							}
						}
					}
				`,
			ExpectedResult: fmt.Sprintf(`
					{
						"site": {
							"id": "U2l0ZToic2l0ZSI=",
							"configuration": {
								"id": 5,
								"history": {
									"totalCount": 5,
									"nodes": [
										{
											"id": %[1]q,
											"author": {
												"id": "VXNlcjoy",
												"username": "bar",
												"displayName": "bar user"
											}
										},
										{
											"id": %[2]q,
											"author": null
										},
										{
											"id": %[3]q,
											"author": null
										}
									],
									"pageInfo": {
									  "hasNextPage": false,
									  "hasPreviousPage": true,
									  "endCursor": %[3]q,
									  "startCursor": %[1]q
									}
								}
							}
						}
					}
				`, marshalSiteConfigurationChangeID(3), marshalSiteConfigurationChangeID(2), marshalSiteConfigurationChangeID(1)),
		},
		{
			Schema:  mustParseGraphQLSchema(t, stubs.db),
			Label:   "Get first 2 site configuration history based on an offset",
			Context: contextWithActor,
			Query: fmt.Sprintf(`
			{
				site {
					id
					configuration {
						id
						history(first: 2, after: %q){
							totalCount
							nodes{
								id
								author{
									id,
									username,
									displayName
								}
							}
							pageInfo {
							  hasNextPage
							  hasPreviousPage
							  endCursor
							  startCursor
							}
						}
					}
				}
			}
		`, marshalSiteConfigurationChangeID(5)),
			ExpectedResult: fmt.Sprintf(`
			{
				"site": {
					"id": "U2l0ZToic2l0ZSI=",
					"configuration": {
						"id": 5,
						"history": {
							"totalCount": 5,
							"nodes": [
								{
									"id": %[1]q,
									"author": {
										"id": "VXNlcjox",
										"username": "foo",
										"displayName": "foo user"
									}
								},
								{
									"id": %[2]q,
									"author": {
										"id": "VXNlcjoy",
										"username": "bar",
										"displayName": "bar user"
									}
								}
							],
							"pageInfo": {
							  "hasNextPage": true,
							  "hasPreviousPage": true,
							  "endCursor": %[2]q,
							  "startCursor": %[1]q
							}
						}
					}
				}
			}
		`, marshalSiteConfigurationChangeID(4), marshalSiteConfigurationChangeID(3)),
		},
		{
			Schema:  mustParseGraphQLSchema(t, stubs.db),
			Label:   "Get last 2 site configuration history based on an offset",
			Context: contextWithActor,
			Query: fmt.Sprintf(`
			{
			  site {
				  id
					configuration {
					  id
						history(last: 2, before: %q){
							totalCount
							nodes{
								id
								author{
									id,
									username,
									displayName
								}
							}
							pageInfo {
							  hasNextPage
							  hasPreviousPage
							  endCursor
							  startCursor
							}
						}
					}
			  }
			}
		`, marshalSiteConfigurationChangeID(1)),
			ExpectedResult: fmt.Sprintf(`
			{
				"site": {
					"id": "U2l0ZToic2l0ZSI=",
					"configuration": {
						"id": 5,
						"history": {
							"totalCount": 5,
							"nodes": [
								 {
									 "id": %[1]q,
									 "author": {
										 "id": "VXNlcjoy",
										 "username": "bar",
										 "displayName": "bar user"
									 }
								 },
								 {
									 "id": %[2]q,
									 "author": null
								 }
							],
							"pageInfo": {
							  "hasNextPage": true,
							  "hasPreviousPage": true,
							  "endCursor": %[2]q,
							  "startCursor": %[1]q
							}
						}
					}
				}
			}
		`, marshalSiteConfigurationChangeID(3), marshalSiteConfigurationChangeID(2)),
		},
	})
}

func TestSiteConfigurationChangeConnectionStoreComputeNodes(t *testing.T) {
	stubs := setupSiteConfigStubs(t)

	ctx := context.Background()
	store := SiteConfigurationChangeConnectionStore{db: stubs.db}

	if _, err := store.ComputeNodes(ctx, nil); err == nil {
		t.Fatalf("expected error but got nil")
	}

	testCases := []struct {
		name                  string
		paginationArgs        *database.PaginationArgs
		expectedSiteConfigIDs []int32
		// value of 0 in expectedPreviousSIteConfigIDs means nil in the test assertion.
		expectedPreviousSiteConfigIDs []int32
	}{
		{
			name: "first: 2",
			paginationArgs: &database.PaginationArgs{
				First: intPtr(2),
			},
			expectedSiteConfigIDs:         []int32{5, 4},
			expectedPreviousSiteConfigIDs: []int32{4, 3},
		},
		{
			name: "first: 5 (exact number of items that exist in the database)",
			paginationArgs: &database.PaginationArgs{
				First: intPtr(5),
			},
			expectedSiteConfigIDs:         []int32{5, 4, 3, 2, 1},
			expectedPreviousSiteConfigIDs: []int32{4, 3, 2, 1, 0},
		},
		{
			name: "first: 20 (more items than what exists in the database)",
			paginationArgs: &database.PaginationArgs{
				First: intPtr(20),
			},
			expectedSiteConfigIDs:         []int32{5, 4, 3, 2, 1},
			expectedPreviousSiteConfigIDs: []int32{4, 3, 2, 1, 0},
		},
		{
			name: "last: 2",
			paginationArgs: &database.PaginationArgs{
				Last: intPtr(2),
			},
			expectedSiteConfigIDs:         []int32{1, 2},
			expectedPreviousSiteConfigIDs: []int32{0, 1},
		},
		{
			name: "last: 5 (exact number of items that exist in the database)",
			paginationArgs: &database.PaginationArgs{
				Last: intPtr(5),
			},
			expectedSiteConfigIDs:         []int32{1, 2, 3, 4, 5},
			expectedPreviousSiteConfigIDs: []int32{0, 1, 2, 3, 4},
		},
		{
			name: "last: 20 (more items than what exists in the database)",
			paginationArgs: &database.PaginationArgs{
				Last: intPtr(20),
			},
			expectedSiteConfigIDs:         []int32{1, 2, 3, 4, 5},
			expectedPreviousSiteConfigIDs: []int32{0, 1, 2, 3, 4},
		},
		{
			name: "first: 2, after: 4",
			paginationArgs: &database.PaginationArgs{
				First: intPtr(2),
				After: toStringPtr(4),
			},
			expectedSiteConfigIDs:         []int32{3, 2},
			expectedPreviousSiteConfigIDs: []int32{2, 1},
		},
		{
			name: "first: 10, after: 4",
			paginationArgs: &database.PaginationArgs{
				First: intPtr(10),
				After: toStringPtr(4),
			},
			expectedSiteConfigIDs:         []int32{3, 2, 1},
			expectedPreviousSiteConfigIDs: []int32{2, 1, 0},
		},
		{
			name: "first: 2, after: 1",
			paginationArgs: &database.PaginationArgs{
				First: intPtr(2),
				After: toStringPtr(1),
			},
			expectedSiteConfigIDs:         []int32{},
			expectedPreviousSiteConfigIDs: []int32{},
		},
		{
			name: "last: 2, before: 2",
			paginationArgs: &database.PaginationArgs{
				Last:   intPtr(2),
				Before: toStringPtr(2),
			},
			expectedSiteConfigIDs:         []int32{3, 4},
			expectedPreviousSiteConfigIDs: []int32{2, 3},
		},
		{
			name: "last: 10, before: 2",
			paginationArgs: &database.PaginationArgs{
				Last:   intPtr(10),
				Before: toStringPtr(2),
			},
			expectedSiteConfigIDs:         []int32{3, 4, 5},
			expectedPreviousSiteConfigIDs: []int32{2, 3, 4},
		},
		{
			name: "last: 2, before: 5",
			paginationArgs: &database.PaginationArgs{
				Last:   intPtr(2),
				Before: toStringPtr(5),
			},
			expectedSiteConfigIDs:         []int32{},
			expectedPreviousSiteConfigIDs: []int32{},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			siteConfigChangeResolvers, err := store.ComputeNodes(ctx, tc.paginationArgs)
			if err != nil {
				t.Errorf("expected nil, but got error: %v", err)
			}

			gotLength := len(siteConfigChangeResolvers)
			expectedLength := len(tc.expectedSiteConfigIDs)
			if gotLength != expectedLength {
				t.Fatalf("mismatched number of SiteConfigurationChangeResolvers, expected %d, got %d", expectedLength, gotLength)
			}

			gotIDs := make([]int32, gotLength)
			for i, got := range siteConfigChangeResolvers {
				gotIDs[i] = got.siteConfig.ID
			}

			if diff := cmp.Diff(tc.expectedSiteConfigIDs, gotIDs); diff != "" {
				t.Errorf("mismatched siteConfig.ID, diff %v", diff)
			}

			if len(tc.expectedPreviousSiteConfigIDs) == 0 {
				return
			}

			gotPreviousSiteConfigIDs := make([]int32, gotLength)
			for i, got := range siteConfigChangeResolvers {
				if got.previousSiteConfig == nil {
					gotPreviousSiteConfigIDs[i] = 0
				} else {
					gotPreviousSiteConfigIDs[i] = got.previousSiteConfig.ID
				}
			}

			if diff := cmp.Diff(tc.expectedPreviousSiteConfigIDs, gotPreviousSiteConfigIDs); diff != "" {
				t.Errorf("mismatched siteConfig.ID, diff %v", diff)
			}
		})
	}
}

func TestModifyArgs(t *testing.T) {
	testCases := []struct {
		name             string
		args             *database.PaginationArgs
		expectedArgs     *database.PaginationArgs
		expectedModified bool
	}{
		{
			name:             "first: 5 (first page)",
			args:             &database.PaginationArgs{First: intPtr(5)},
			expectedArgs:     &database.PaginationArgs{First: intPtr(6)},
			expectedModified: true,
		},
		{
			name:             "first: 5, after: 10 (next page)",
			args:             &database.PaginationArgs{First: intPtr(5), After: toStringPtr(10)},
			expectedArgs:     &database.PaginationArgs{First: intPtr(6), After: toStringPtr(10)},
			expectedModified: true,
		},
		{
			name:             "last: 5 (last page)",
			args:             &database.PaginationArgs{Last: intPtr(5)},
			expectedArgs:     &database.PaginationArgs{Last: intPtr(5)},
			expectedModified: false,
		},
		{
			name:             "last: 5, before: 10 (previous page)",
			args:             &database.PaginationArgs{Last: intPtr(5), Before: toStringPtr(10)},
			expectedArgs:     &database.PaginationArgs{Last: intPtr(6), Before: toStringPtr(9)},
			expectedModified: true,
		},
		{
			name:             "last: 5, before: 1 (edge case)",
			args:             &database.PaginationArgs{Last: intPtr(5), Before: toStringPtr(1)},
			expectedArgs:     &database.PaginationArgs{Last: intPtr(6), Before: toStringPtr(0)},
			expectedModified: true,
		},
		{
			name:             "last: 5, before: 0 (same as last page but a mathematical  edge case)",
			args:             &database.PaginationArgs{Last: intPtr(5), Before: toStringPtr(0)},
			expectedArgs:     &database.PaginationArgs{Last: intPtr(5), Before: toStringPtr(0)},
			expectedModified: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			modified, err := modifyArgs(tc.args)
			if err != nil {
				t.Fatal(err)
			}

			if modified != tc.expectedModified {
				t.Errorf("Expected modified to be %v, but got %v", modified, tc.expectedModified)
			}

			if diff := cmp.Diff(tc.args, tc.expectedArgs); diff != "" {
				t.Errorf("Mismatch in modified args: %v", diff)
			}
		})
	}
}
